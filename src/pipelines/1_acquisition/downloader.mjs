import { open, mkdir, stat, readFile, readdir, rm, rename } from 'node:fs/promises';
import { createWriteStream, existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { downloadWebComic } from './web_comic.mjs';
import { registerArchivedComicSafely } from '../4_inducks_collection/collection.mjs';
import { getItemDetails, selectItemFiles } from './archive_org.mjs';
import { colorize } from '../../core/terminal.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const binDir = path.resolve(__dirname, '../../../../download-files/bin');
const localAria2 = path.join(binDir, 'aria2c.exe');

function cleanUrl(url) {
  return url.trim().replace(/^["']|["']$/g, '');
}

async function getAria2Path() {
  if (existsSync(localAria2)) return localAria2;

  const inPath = spawnSync('where', ['aria2c.exe'], { encoding: 'utf8', shell: true });
  if (inPath.status === 0 && inPath.stdout.trim()) {
    return inPath.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

export async function resolveMediafire(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`Mediafire HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/href="(https?:\/\/download\d+\.mediafire\.com\/[^"]+)"/i) ||
                html.match(/aria-label="Download file"\s+href="([^"]+)"/i);
  if (!match) throw new Error('Direct Mediafire download link not found in page');
  return match[1];
}

function downloadWithAria2(aria2Path, urls, outputDir, options = {}) {
  return new Promise((resolve, reject) => {
    const inputListFile = path.join(outputDir, `.aria2_input_${Date.now()}.txt`);
    const content = urls.join('\n');
    const maxConnections = options.connections || 16;

    createWriteStream(inputListFile).end(content, async () => {
      const args = [
        `--input-file=${inputListFile}`,
        `--dir=${outputDir}`,
        `--max-connection-per-server=${maxConnections}`,
        `--split=${maxConnections}`,
        `--min-split-size=1M`,
        `--max-concurrent-downloads=${options.concurrent || 4}`,
        `--continue=true`,
        `--auto-file-renaming=true`,
        `--allow-overwrite=true`,
        `--summary-interval=1`,
        `--console-log-level=notice`,
      ];

      console.log(`Starting multi-connection download with aria2c (${maxConnections} conns/file)...`);
      const child = spawn(aria2Path, args, { stdio: 'inherit' });

      child.on('close', async (code) => {
        await rm(inputListFile, { force: true });
        if (code === 0) resolve();
        else reject(new Error(`aria2c exited with code ${code}`));
      });
      child.on('error', (err) => reject(err));
    });
  });
}

/**
 * Downloads a list of links (files.txt or DLC)
 */
export async function downloadLinksFile(filePath, options = {}) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`Input is not a file: ${filePath}`);

  const baseName = path.parse(filePath).name;
  const parentDir = path.dirname(filePath);

  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.join(parentDir, `${baseName}_downloads`);

  await mkdir(outputDir, { recursive: true });
  const initialArchiveStates = new Map();
  for (const entry of await readdir(outputDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(cbr|cbz)$/i.test(entry.name)) {
      const existingPath = path.join(outputDir, entry.name);
      const existingStat = await stat(existingPath);
      initialArchiveStates.set(entry.name, `${existingStat.size}:${existingStat.mtimeMs}`);
    }
  }
  const registeredArchivePaths = new Set();

  const rawContent = await readFile(filePath, 'utf8');
  const urls = rawContent
    .split(/\r?\n/)
    .map(cleanUrl)
    .filter((line) => /^https?:\/\//i.test(line));

  if (urls.length === 0) throw new Error('Aucun lien valide trouvé dans le fichier.');

  console.log(`\n========================================`);
  console.log(`  📦 Batch Downloader`);
  console.log(`  Fichier:   ${path.basename(filePath)}`);
  console.log(`  Liens:     ${urls.length}`);
  console.log(`  Dossier:   ${outputDir}`);
  console.log(`========================================\n`);

  const webComicUrls = urls.filter(u => /comic-viewer|bookUri=|comicmafia\.to\/reader/i.test(u));
  const directUrls = urls.filter(u => !/comic-viewer|bookUri=|comicmafia\.to\/reader/i.test(u));

  // 1. Web Comic links (selected CBR/CBZ format)
  if (webComicUrls.length > 0) {
    console.log(`[+] ${webComicUrls.length} tome(s) Comic Viewer détecté(s). Format : ${(options.archiveFormat || 'cbr').toUpperCase()}...`);
    for (let i = 0; i < webComicUrls.length; i++) {
      console.log(`\n--- [Tome Web ${i + 1}/${webComicUrls.length}] ---`);
      try {
        const archivePath = await downloadWebComic(webComicUrls[i], outputDir, null, options);
        if (archivePath) registeredArchivePaths.add(path.resolve(archivePath));
      } catch (err) {
        console.error(colorize(`  [ERROR] Échec téléchargement tome : ${err.message}`, 'red'));
      }
    }
  }

  // 2. Direct download links
  if (directUrls.length > 0) {
    console.log(`\n[+] ${directUrls.length} lien(s) direct(s) à télécharger...`);
    const resolvedUrls = [];
    for (const u of directUrls) {
      if (/archive\.org\/details\/([^\/\?#]+)/i.test(u)) {
        try {
          const id = u.match(/archive\.org\/details\/([^\/\?#]+)/i)[1];
          process.stdout.write(`Résolution Archive.org (${id})... `);
          const details = await getItemDetails(id);
          const selected = selectItemFiles(details, 'hd');
          if (selected.length > 0) {
            resolvedUrls.push(selected[0].downloadUrl);
            console.log(`OK (${selected[0].name})`);
          } else {
            console.log('Aucun PDF trouvé');
          }
        } catch (err) {
          console.error(`Échec: ${err.message}`);
        }
      } else {
        resolvedUrls.push(u);
      }
    }

    const aria2Path = options.noAria2 ? null : await getAria2Path();
    if (aria2Path && resolvedUrls.length > 0) {
      await downloadWithAria2(aria2Path, resolvedUrls, outputDir, options);
    } else {
      console.log('aria2c non détecté ou aucun lien résolu.');
    }
  }

  for (const entry of await readdir(outputDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(cbr|cbz)$/i.test(entry.name)) continue;
    const archivePath = path.resolve(outputDir, entry.name);
    if (registeredArchivePaths.has(archivePath)) continue;
    const currentStat = await stat(archivePath);
    const state = `${currentStat.size}:${currentStat.mtimeMs}`;
    if (initialArchiveStates.get(entry.name) === state) continue;
    await registerArchivedComicSafely(archivePath);
  }
}
