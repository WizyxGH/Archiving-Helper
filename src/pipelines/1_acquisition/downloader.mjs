import { open, mkdir, stat, readFile, readdir, rm, rename } from 'node:fs/promises';
import { createWriteStream, existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { downloadWebComic } from './web_comic.mjs';

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

  const rawContent = await readFile(filePath, 'utf8');
  const urls = rawContent
    .split(/\r?\n/)
    .map(cleanUrl)
    .filter((line) => /^https?:\/\//i.test(line));

  // Deduplicate identical URLs
  const uniqueUrls = Array.from(new Set(urls));
  const duplicateCount = urls.length - uniqueUrls.length;

  console.log(`\n========================================`);
  console.log(`  📦 Batch Downloader`);
  console.log(`  Fichier:   ${path.basename(filePath)}`);
  console.log(`  Liens:     ${uniqueUrls.length}${duplicateCount > 0 ? ` (${duplicateCount} doublons éliminés)` : ''}`);
  console.log(`  Dossier:   ${outputDir}`);
  console.log(`========================================\n`);

  const webComicUrls = uniqueUrls.filter(u => /comic-viewer|bookUri=|comicmafia\.to\/reader/i.test(u));
  const directUrls = uniqueUrls.filter(u => !/comic-viewer|bookUri=|comicmafia\.to\/reader/i.test(u));

  // 1. Web Comic links (Automatic CBZ generator)
  if (webComicUrls.length > 0) {
    console.log(`[+] ${webComicUrls.length} tome(s) Comic Viewer détecté(s). Téléchargement automatique vers CBZ...`);
    for (let i = 0; i < webComicUrls.length; i++) {
      console.log(`\n--- [Tome Web ${i + 1}/${webComicUrls.length}] ---`);
      try {
        await downloadWebComic(webComicUrls[i], outputDir, null, options);
      } catch (err) {
        console.error(`  [ERROR] Échec téléchargement tome : ${err.message}`);
      }
    }
  }

  // 2. Direct download links
  if (directUrls.length > 0) {
    console.log(`\n[+] ${directUrls.length} lien(s) direct(s) à télécharger...`);
    const aria2Path = options.noAria2 ? null : await getAria2Path();
    if (aria2Path) {
      await downloadWithAria2(aria2Path, directUrls, outputDir, options);
    } else {
      console.log('aria2c non détecté. Téléchargement Node...');
    }
  }
}
