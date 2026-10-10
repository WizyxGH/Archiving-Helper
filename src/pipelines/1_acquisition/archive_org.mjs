import fs from 'node:fs';
import { mkdir, stat, rm, readdir } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { colorize } from '../../core/terminal.mjs';
import { collectionDirectory, downloadFilesDir, rootDir } from '../../core/config.mjs';
import { registerArchivedComicSafely } from '../4_inducks_collection/collection.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const binDir = path.resolve(downloadFilesDir, 'bin');
const localAria2 = path.join(binDir, 'aria2c.exe');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes) || bytes < 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function parseRangeSelection(input, max) {
  const trimmed = (input || '').trim().toLowerCase();
  if (!trimmed || trimmed === 'all' || trimmed === 'tous' || trimmed === 'a') {
    return Array.from({ length: max }, (_, i) => i);
  }

  const indices = new Set();
  const parts = trimmed.split(/[\s,]+/);

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        const minVal = Math.max(1, Math.min(start, end));
        const maxVal = Math.min(max, Math.max(start, end));
        for (let i = minVal; i <= maxVal; i++) {
          indices.add(i - 1);
        }
      }
    } else {
      const num = parseInt(part, 10);
      if (!isNaN(num) && num >= 1 && num <= max) {
        indices.add(num - 1);
      }
    }
  }

  return Array.from(indices).sort((a, b) => a - b);
}

async function safeFetch(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
        ...options,
      });
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function getAria2Path() {
  if (existsSync(localAria2)) return localAria2;
  const inPath = spawnSync('where', ['aria2c.exe'], { encoding: 'utf8', shell: true });
  if (inPath.status === 0 && inPath.stdout.trim()) {
    return inPath.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

/**
 * Parses user input to determine if it's a search URL, item URL, direct download, or query.
 */
export function parseArchiveOrgInput(input) {
  const str = (input || '').trim().replace(/^["']|["']$/g, '');
  if (!str) return null;

  if (/^https?:\/\//i.test(str)) {
    try {
      const url = new URL(str);
      if (/archive\.org$/i.test(url.hostname)) {
        // 1. Search page: https://archive.org/search?query=...
        if (/^\/search(\.php)?/i.test(url.pathname)) {
          const q = url.searchParams.get('query') || url.searchParams.get('q');
          if (q) return { type: 'search', query: q };
        }

        // 2. Direct download: https://archive.org/download/<id>/<file>
        if (url.pathname.startsWith('/download/')) {
          const segments = url.pathname.split('/').filter(Boolean);
          if (segments.length >= 3) {
            const identifier = segments[1];
            const filename = decodeURIComponent(segments.slice(2).join('/'));
            return { type: 'direct_file', identifier, filename, url: str };
          }
          if (segments.length === 2) {
            return { type: 'item', identifier: segments[1] };
          }
        }

        // 3. Details page: https://archive.org/details/<id>
        if (url.pathname.startsWith('/details/')) {
          const segments = url.pathname.split('/').filter(Boolean);
          if (segments.length >= 2) {
            return { type: 'item', identifier: segments[1] };
          }
        }
      }
    } catch {}
  }

  // Not an archive.org URL: treat as search terms
  return { type: 'search', query: str };
}

/**
 * Searches Archive.org for texts/comics matching query.
 */
export async function searchArchiveOrg(query, options = {}) {
  const rows = options.rows || 50;
  const page = options.page || 1;
  const sort = options.sort || 'downloads desc';
  const mediatype = options.mediatype || 'texts';

  let cleanQuery = query.trim();
  let fullQuery = cleanQuery;

  if (options.restrictTexts !== false && !/mediatype:/i.test(cleanQuery)) {
    fullQuery = `(${cleanQuery}) AND mediatype:(${mediatype})`;
  }

  const params = new URLSearchParams();
  params.append('q', fullQuery);
  params.append('fl[]', 'identifier');
  params.append('fl[]', 'title');
  params.append('fl[]', 'year');
  params.append('fl[]', 'publicdate');
  params.append('fl[]', 'downloads');
  params.append('fl[]', 'format');
  params.append('sort[]', sort);
  params.append('rows', String(rows));
  params.append('page', String(page));
  params.append('output', 'json');

  const url = `https://archive.org/advancedsearch.php?${params.toString()}`;
  const res = await safeFetch(url);
  if (!res.ok) throw new Error(`Archive.org search failed: HTTP ${res.status}`);
  const data = await res.json();

  return {
    total: data.response?.numFound || 0,
    items: data.response?.docs || [],
    page,
    rows,
  };
}

/**
 * Fetches files and metadata for an item. Detects if item is actually a collection.
 */
export async function getItemDetails(identifier) {
  const metaUrl = `https://archive.org/metadata/${identifier}`;
  const res = await safeFetch(metaUrl);
  if (!res.ok) throw new Error(`Archive.org metadata failed for "${identifier}": HTTP ${res.status}`);
  const data = await res.json();

  const metadata = data.metadata || {};
  const isCollection = metadata.mediatype === 'collection';
  const rawFiles = data.files || [];

  const files = [];
  for (const f of rawFiles) {
    const name = f.name || '';
    const format = f.format || '';
    const size = parseInt(f.size, 10) || 0;
    const source = f.source || '';

    // Ignore encrypted borrowable PDFs
    if (/encrypted/i.test(format)) continue;

    const isPdf = name.toLowerCase().endsWith('.pdf') || /pdf/i.test(format);
    const isCbz = /\.(cbz|cbr)$/i.test(name) || /comic book/i.test(format);

    if (isPdf || isCbz) {
      const isImageContainer = /image container/i.test(format) || (source === 'original' && isPdf);
      const isTextPdf = /text pdf/i.test(format) || /_text\.pdf$/i.test(name);

      files.push({
        name,
        format,
        size,
        source,
        isPdf,
        isCbz,
        isImageContainer,
        isTextPdf,
        downloadUrl: `https://archive.org/download/${identifier}/${encodeURIComponent(name)}`,
      });
    }
  }

  return {
    identifier,
    title: metadata.title || identifier,
    description: metadata.description || '',
    year: metadata.year || metadata.date || '',
    isCollection,
    files,
  };
}

/**
 * Selects best files for an item based on preference ('hd', 'text', 'cbz', 'all').
 */
export function selectItemFiles(itemDetails, preference = 'hd') {
  const files = itemDetails.files || [];
  if (files.length === 0) return [];

  if (preference === 'all') {
    return files;
  }

  if (preference === 'cbz') {
    const cbzFiles = files.filter((f) => f.isCbz);
    if (cbzFiles.length > 0) return cbzFiles;
    // Fallback to HD PDF if no CBZ exists
    preference = 'hd';
  }

  const pdfFiles = files.filter((f) => f.isPdf);
  if (pdfFiles.length === 0) return files.filter((f) => f.isCbz);

  if (preference === 'text') {
    // Prefer OCR / text derivative PDF
    const textPdf = pdfFiles.find((f) => f.isTextPdf);
    if (textPdf) return [textPdf];
    // Smallest PDF fallback
    const sorted = [...pdfFiles].sort((a, b) => a.size - b.size);
    return [sorted[0]];
  }

  // Default 'hd': prefer Image Container PDF (original HD scan)
  const hdPdf = pdfFiles.find((f) => f.isImageContainer);
  if (hdPdf) return [hdPdf];

  // Otherwise, take the largest PDF (usually the best quality scan)
  const sorted = [...pdfFiles].sort((a, b) => b.size - a.size);
  return [sorted[0]];
}

/**
 * Download using aria2c
 */
function downloadWithAria2(aria2Path, downloadEntries, outputDir, options = {}) {
  return new Promise((resolve, reject) => {
    const inputListFile = path.join(outputDir, `.aria2_archive_org_${Date.now()}.txt`);
    
    // Build aria2 input format: URL followed by optional out=filename
    const lines = [];
    for (const item of downloadEntries) {
      lines.push(item.downloadUrl);
      if (item.name) {
        lines.push(`  out=${item.name}`);
      }
    }

    const content = lines.join('\n');
    const maxConnections = options.connections || 8;

    createWriteStream(inputListFile).end(content, async () => {
      const args = [
        `--input-file=${inputListFile}`,
        `--dir=${outputDir}`,
        `--max-connection-per-server=${maxConnections}`,
        `--split=${maxConnections}`,
        `--min-split-size=1M`,
        `--max-concurrent-downloads=${options.concurrent || 3}`,
        `--continue=true`,
        `--auto-file-renaming=false`,
        `--allow-overwrite=false`,
        `--summary-interval=1`,
        `--console-log-level=notice`,
      ];

      console.log(`[aria2c] Téléchargement haute vitesse multi-connexions (${maxConnections} conns/fichier)...`);
      const child = spawn(aria2Path, args, { stdio: 'inherit' });

      child.on('close', async (code) => {
        await rm(inputListFile, { force: true }).catch(() => {});
        if (code === 0) resolve();
        else reject(new Error(`aria2c s'est arrêté avec le code ${code}`));
      });
      child.on('error', (err) => reject(err));
    });
  });
}

/**
 * Native Node download fallback
 */
async function downloadWithNode(downloadEntry, outputDir) {
  const destPath = path.join(outputDir, downloadEntry.name);

  if (existsSync(destPath)) {
    const s = await stat(destPath);
    if (downloadEntry.size > 0 && s.size === downloadEntry.size) {
      console.log(`  [DÉJÀ TÉLÉCHARGÉ] ${downloadEntry.name} (${formatBytes(s.size)})`);
      return destPath;
    }
  }

  console.log(`  [TÉLÉCHARGEMENT] ${downloadEntry.name} (${formatBytes(downloadEntry.size)})...`);
  const res = await safeFetch(downloadEntry.downloadUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${downloadEntry.downloadUrl}`);

  const tempPath = `${destPath}.tmp_${Date.now()}`;
  const fileStream = createWriteStream(tempPath);
  await pipeline(Readable.fromWeb(res.body), fileStream);
  fs.renameSync(tempPath, destPath);
  console.log(`  [OK] Sauvegardé : ${downloadEntry.name}`);
  return destPath;
}

/**
 * Main batch download orchestrator for Archive.org
 */
export async function downloadArchiveOrgItems(downloadEntries, outputDir, options = {}) {
  await mkdir(outputDir, { recursive: true });

  const aria2Path = options.noAria2 ? null : await getAria2Path();

  if (aria2Path && downloadEntries.length > 0) {
    await downloadWithAria2(aria2Path, downloadEntries, outputDir, options);
  } else {
    for (let i = 0; i < downloadEntries.length; i++) {
      const entry = downloadEntries[i];
      console.log(`\n[${i + 1}/${downloadEntries.length}] ${entry.name}`);
      try {
        await downloadWithNode(entry, outputDir);
      } catch (err) {
        console.error(colorize(`  [ERROR] Échec : ${err.message}`, 'red'));
      }
    }
  }

  // Post-processing: auto-convert PDF to CBZ if enabled
  if (options.convertToCbz) {
    const pdfConverterScript = path.join(rootDir, 'convert-pdf-to-jpg', 'pdf-to-jpg.mjs');
    if (existsSync(pdfConverterScript)) {
      const downloadedPdfs = downloadEntries
        .filter((e) => /\.pdf$/i.test(e.name))
        .map((e) => path.join(outputDir, e.name))
        .filter((p) => existsSync(p));

      if (downloadedPdfs.length > 0) {
        console.log(`\n======================================================`);
        console.log(`  🔄 CONVERSION DES PDFS VERS CBZ`);
        console.log(`======================================================\n`);
        for (const pdfPath of downloadedPdfs) {
          console.log(`Conversion de ${path.basename(pdfPath)} vers CBZ...`);
          try {
            spawnSync('node', [pdfConverterScript, pdfPath, '--archive', 'cbz'], { stdio: 'inherit' });
          } catch (err) {
            console.error(`Erreur conversion CBZ pour ${pdfPath}: ${err.message}`);
          }
        }
      }
    }
  }

  // Auto-register to Inducks collection if CBZ/CBR files were created
  for (const entry of await readdir(outputDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(cbr|cbz)$/i.test(entry.name)) {
      const archivePath = path.resolve(outputDir, entry.name);
      await registerArchivedComicSafely(archivePath);
    }
  }
}

/**
 * High-level runner: takes user input (URL or query), fetches items, selects files, and downloads.
 */
export async function runArchiveOrgAcquisition(input, options = {}) {
  const parsed = parseArchiveOrgInput(input);
  if (!parsed) {
    throw new Error('Entrée Archive.org vide ou invalide.');
  }

  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.join(collectionDirectory(), 'Archive_Org');

  console.log(`\n======================================================`);
  console.log(`  🏛️ ARCHIVE.ORG DOWNLOADER`);
  console.log(`  Cible :    ${input}`);
  console.log(`  Dossier :  ${outputDir}`);
  console.log(`  Format :   ${(options.preference || 'hd').toUpperCase()} (Scan HD par défaut)`);
  console.log(`======================================================\n`);

  let itemsToProcess = [];

  if (parsed.type === 'direct_file') {
    itemsToProcess = [
      {
        downloadUrl: parsed.url,
        name: parsed.filename,
        size: 0,
        isPdf: /\.pdf$/i.test(parsed.filename),
      },
    ];
  } else if (parsed.type === 'item') {
    console.log(`[>] Récupération des informations de l'élément "${parsed.identifier}"...`);
    const details = await getItemDetails(parsed.identifier);

    if (details.isCollection) {
      console.log(`[i] L'identifiant correspond à une collection ("${details.title}"). Recherche des tomes...`);
      const searchRes = await searchArchiveOrg(`collection:(${parsed.identifier})`, {
        rows: options.limit || 50,
      });
      itemsToProcess = searchRes.items.map((i) => ({ identifier: i.identifier, title: i.title }));
    } else {
      const selected = selectItemFiles(details, options.preference || 'hd');
      if (selected.length === 0) {
        throw new Error(`Aucun fichier PDF ou archive trouvé pour l'élément "${parsed.identifier}".`);
      }
      itemsToProcess = selected;
    }
  } else if (parsed.type === 'search') {
    console.log(`[>] Recherche sur Archive.org pour "${parsed.query}"...`);
    const searchRes = await searchArchiveOrg(parsed.query, {
      rows: options.limit || 50,
    });

    console.log(`[OK] ${searchRes.total} résultat(s) trouvé(s) au total sur Archive.org.`);
    if (searchRes.items.length === 0) {
      console.log(`[!] Aucun résultat trouvé pour "${parsed.query}".`);
      return [];
    }

    itemsToProcess = searchRes.items.map((i) => ({
      identifier: i.identifier,
      title: i.title,
      year: i.year,
      downloads: i.downloads,
    }));
  }

  // If we have items (identifiers) that need file resolution
  const finalDownloadEntries = [];

  if (itemsToProcess.length > 0 && itemsToProcess[0].identifier && !itemsToProcess[0].downloadUrl) {
    const countToFetch = options.limit ? Math.min(options.limit, itemsToProcess.length) : itemsToProcess.length;
    console.log(`\n[>] Analyse des fichiers pour ${countToFetch} tome(s)...`);

    for (let i = 0; i < countToFetch; i++) {
      const it = itemsToProcess[i];
      process.stdout.write(`\r  [${i + 1}/${countToFetch}] Récupération metadata : ${it.identifier.slice(0, 40)}...`);
      try {
        const details = await getItemDetails(it.identifier);
        const selected = selectItemFiles(details, options.preference || 'hd');
        for (const f of selected) {
          finalDownloadEntries.push(f);
        }
      } catch (err) {
        // Skip inaccessible item
      }
    }
    console.log(`\n[OK] ${finalDownloadEntries.length} fichier(s) sélectionné(s) pour téléchargement.\n`);
  } else {
    for (const f of itemsToProcess) {
      finalDownloadEntries.push(f);
    }
  }

  if (finalDownloadEntries.length === 0) {
    console.log('[!] Aucun fichier téléchargeable trouvé.');
    return [];
  }

  // Display summary of files
  let totalBytes = 0;
  for (const f of finalDownloadEntries) {
    totalBytes += f.size || 0;
    console.log(`  • ${f.name} (${formatBytes(f.size)})`);
  }
  if (totalBytes > 0) {
    console.log(`\n📦 Volume total estimé : ${formatBytes(totalBytes)}`);
  }

  await downloadArchiveOrgItems(finalDownloadEntries, outputDir, options);
  console.log(colorize(`\n✨ Téléchargement Archive.org terminé avec succès dans :\n   ${outputDir}\n`, 'green'));

  return finalDownloadEntries;
}
