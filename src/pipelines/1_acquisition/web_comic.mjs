import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import { colorize } from '../../core/terminal.mjs';
import { orderPageKeysByInducks } from '../../core/inducks/issue_index.mjs';
import { registerArchivedComicSafely } from '../4_inducks_collection/collection.mjs';
import { cleanJpegLossless } from '../../core/formats/jpeg.mjs';
import { resolveInducksPublication } from '../../core/inducks/inducks.mjs';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://comicmafia.to/reader/comic-viewer.html',
  'Sec-Fetch-Dest': 'image',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Site': 'same-origin'
};

function findRarExecutable() {
  const inPath = spawnSync('where', ['Rar.exe'], { encoding: 'utf8', shell: true });
  if (inPath.status === 0 && inPath.stdout.trim()) return inPath.stdout.trim().split(/\r?\n/)[0];

  for (const candidate of [
    'C:\\Program Files\\WinRAR\\Rar.exe',
    'C:\\Program Files (x86)\\WinRAR\\Rar.exe',
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function safeFetch(url, options = {}, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) }
      });

      if (res.status === 429) {
        const waitTime = attempt * 5;
        console.warn(colorize(`\n[!] Rate-limit détecté (HTTP 429). Pause de ${waitTime}s...`, 'yellow'));
        await new Promise(r => setTimeout(r, waitTime * 1000));
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

/**
 * Downloads a comic from an online reader and packages it directly into a clean CBZ
 */
export async function downloadWebComic(bookUri, outputDir, customTomeNum = null, options = {}) {
  const archiveFormat = String(options.archiveFormat || 'cbr').toLowerCase();
  if (!['cbr', 'cbz'].includes(archiveFormat)) {
    throw new Error('Format invalide. Choisissez CBR ou CBZ.');
  }
  const rarExecutable = archiveFormat === 'cbr' ? findRarExecutable() : null;
  if (archiveFormat === 'cbr' && !rarExecutable) {
    throw new Error('WinRAR (Rar.exe) est requis pour créer un CBR. Choisissez CBZ ou installez WinRAR.');
  }

  const targetDir = outputDir || path.resolve(os.homedir(), 'Downloads');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let rawUri = bookUri;
  if (rawUri.includes('bookUri=')) {
    const m = rawUri.match(/bookUri=([^&]+)/);
    if (m) rawUri = decodeURIComponent(decodeURIComponent(m[1]));
  }

  const inducks = await resolveInducksPublication(rawUri, { customTomeNum });
  const archiveStem = path.basename(inducks.archiveFilename, path.extname(inducks.archiveFilename));
  const archiveFilename = `${archiveStem}.${archiveFormat}`;
  const finalArchivePath = path.join(targetDir, archiveFilename);

  const stagingName = inducks.canonicalStem || archiveFilename.replace(/\.cbz$/i, '');
  const tempFolder = path.join(os.tmpdir(), 'archiving-helper', `staging_${stagingName}`);
  fs.mkdirSync(tempFolder, { recursive: true });

  console.log(`\n========================================================`);
  if (inducks.isCertified) {
    console.log(colorize(`  [OK] Inducks  : ${inducks.matchedPublication.title} (${inducks.canonicalStem})`, 'green'));
  } else {
    console.log(colorize(`  [!] Inducks   : Non répertorié avec certitude -> Nom d'origine préservé`, 'yellow'));
  }
  console.log(`  Archive Cible : ${archiveFilename}`);
  console.log(`  Destination   : ${targetDir}`);
  console.log(`  Source URI    : ${rawUri}`);
  console.log(`  Mode          : Lossless (100% sans perte de qualité)`);
  console.log(`  Temp Staging  : ${tempFolder} (hors git)`);
  console.log(`  Nomenclature  : ${inducks.imagePrefix}1.jpg, ${inducks.imagePrefix}2.jpg...`);
  console.log(`========================================================`);

  try {
    const apiUrl = `https://comicmafia.to/reader/comic_pages.php?bookUri=${encodeURIComponent(encodeURIComponent(rawUri))}`;
    const res = await safeFetch(apiUrl, {
      headers: { 'Accept': 'application/json, text/javascript, */*; q=0.01' }
    });

    const responseText = await res.text();
    const jsonStart = responseText.search(/\{\s*"status"\s*:/);
    if (jsonStart < 0) {
      if (/no space left on device|errno\s*=\s*28/i.test(responseText)) {
        throw new Error('Le serveur ComicMafia est saturé (espace disque insuffisant). Réessayez plus tard.');
      }
      throw new Error(`Réponse illisible de l’API ComicMafia pour ${rawUri}.`);
    }

    let json;
    try {
      json = JSON.parse(responseText.slice(jsonStart));
    } catch {
      throw new Error(`Réponse JSON invalide de l’API ComicMafia pour ${rawUri}.`);
    }
    if (json.status !== 'success' || !json.urls) {
      if (/no space left on device|errno\s*=\s*28/i.test(responseText) || /CP-100003/i.test(json.message || '')) {
        throw new Error('Le serveur ComicMafia est saturé (espace disque insuffisant). Réessayez plus tard.');
      }
      throw new Error(`API ComicMafia : ${json.message || `erreur pour ${rawUri}`}`);
    }

    const pageKeys = orderPageKeysByInducks(Object.keys(json.urls), inducks.issueEntries);
    const totalPages = pageKeys.length;
    console.log(colorize(`[+] Total pages à télécharger : ${totalPages}`, 'cyan'));

    const CONCURRENCY = options.concurrency || 8;
    const pageBuffers = new Map();
    let downloadedCount = 0;
    let totalBytesDownloaded = 0;
    let nextIndex = 0;
    const downloadStartTime = Date.now();

    function formatEta(seconds) {
      if (!isFinite(seconds) || seconds <= 0) return '--:--';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    async function worker() {
      while (nextIndex < totalPages) {
        const currentIdx = nextIndex++;
        const pageKey = pageKeys[currentIdx];
        const rawPath = decodeURIComponent(json.urls[pageKey]);
        const imgUrl = rawPath.startsWith('http') ? rawPath : `https://comicmafia.to${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;
        const pageNum = parseInt(pageKey, 10) + 1;

        const imgRes = await safeFetch(imgUrl);
        const rawBuffer = Buffer.from(await imgRes.arrayBuffer());
        totalBytesDownloaded += rawBuffer.length;
        const optimizedBuffer = cleanJpegLossless(rawBuffer);

        pageBuffers.set(pageNum, optimizedBuffer);
        downloadedCount++;

        const percent = Math.round((downloadedCount / totalPages) * 100);
        const elapsedSec = Math.max(0.1, (Date.now() - downloadStartTime) / 1000);
        const pagesPerSec = (downloadedCount / elapsedSec).toFixed(1);
        const mbPerSec = ((totalBytesDownloaded / (1024 * 1024)) / elapsedSec).toFixed(1);
        const remainingPages = totalPages - downloadedCount;
        const etaSec = pagesPerSec > 0 ? remainingPages / parseFloat(pagesPerSec) : 0;
        const eta = formatEta(etaSec);

        const barFilled = Math.round((downloadedCount / totalPages) * 15);
        const bar = '█'.repeat(barFilled) + '░'.repeat(15 - barFilled);

        process.stdout.write(colorize(`\r[*] [${bar}] ${downloadedCount}/${totalPages} (${percent}%) | ${pagesPerSec} p/s (${mbPerSec} Mo/s) | ETA: ${eta}  `, 'cyan'));
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, totalPages) }, () => worker());
    await Promise.all(workers);

    const downloadDuration = ((Date.now() - downloadStartTime) / 1000).toFixed(1);
    const avgSpeedMb = ((totalBytesDownloaded / (1024 * 1024)) / Math.max(0.1, downloadDuration)).toFixed(1);
    console.log(colorize(`\n[+] Téléchargement terminé en ${downloadDuration}s (${(totalPages / downloadDuration).toFixed(1)} p/s - ${avgSpeedMb} Mo/s).`, 'green'));
    console.log(colorize(`[*] Empaquetage direct dans l'archive ${archiveFormat.toUpperCase()} : ${archiveFilename}...`, 'cyan'));

    if (archiveFormat === 'cbz') {
      const zip = new AdmZip();
      for (let p = 1; p <= totalPages; p++) {
        const entryName = `${inducks.imagePrefix}${p}.jpg`;
        const buffer = pageBuffers.get(p);
        if (buffer) zip.addFile(entryName, buffer);
      }
      zip.writeZip(finalArchivePath);
    } else {
      const rarPages = [];
      for (let p = 1; p <= totalPages; p++) {
        const entryName = `${inducks.imagePrefix}${p}.jpg`;
        const buffer = pageBuffers.get(p);
        if (!buffer) continue;
        fs.writeFileSync(path.join(tempFolder, entryName), buffer);
        rarPages.push(entryName);
      }

      fs.writeFileSync(path.join(tempFolder, 'pages.txt'), rarPages.join('\r\n'));
      const tempArchivePath = path.join(tempFolder, archiveFilename);
      const rarResult = spawnSync(
        rarExecutable,
        ['a', '-m0', '-ep', '-idq', tempArchivePath, '@pages.txt'],
        { cwd: tempFolder, encoding: 'utf8' },
      );
      if (rarResult.error || rarResult.status !== 0 || !fs.existsSync(tempArchivePath)) {
        throw new Error(`Échec de création CBR avec WinRAR : ${(rarResult.stderr || rarResult.stdout || rarResult.error?.message || `code ${rarResult.status}`).trim()}`);
      }
      fs.copyFileSync(tempArchivePath, finalArchivePath);
    }

    const stats = fs.statSync(finalArchivePath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
    const totalDuration = ((Date.now() - downloadStartTime) / 1000).toFixed(1);
    await registerArchivedComicSafely(finalArchivePath, { inducks });
    console.log(colorize(`[+] SUCCÈS ! Archive prête : ${finalArchivePath} (${sizeMb} Mo en ${totalDuration}s)\n`, 'green'));
    return finalArchivePath;

  } finally {
    try {
      if (fs.existsSync(tempFolder)) {
        fs.rmSync(tempFolder, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}
