import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { cleanJpegLossless } from './jpeg.mjs';
import { naturalSort } from './sorter.mjs';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://comicmafia.to/reader/comic-viewer.html',
  'Sec-Fetch-Dest': 'image',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Site': 'same-origin'
};

/**
 * Robust fetch with automatic retry on HTTP 429 rate limit
 */
async function safeFetch(url, options = {}, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) }
      });

      if (res.status === 429) {
        const waitTime = attempt * 5;
        console.warn(`\n[!] Rate-limit détecté (HTTP 429). Pause de ${waitTime}s avant reprise...`);
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
 * Downloads a comic from an online reader (ComicMafia) and packages it directly into a clean CBR/CBZ
 * Uses a high-performance worker pool and in-memory compression to maximize speed.
 */
export async function downloadWebComic(bookUri, outputDir, customTomeNum = null, options = {}) {
  const targetDir = outputDir || path.resolve(os.homedir(), 'Downloads');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Parse URI if full URL was passed
  let rawUri = bookUri;
  if (rawUri.includes('bookUri=')) {
    const m = rawUri.match(/bookUri=([^&]+)/);
    if (m) rawUri = decodeURIComponent(decodeURIComponent(m[1]));
  }

  // Determine volume number
  let tomeNum = customTomeNum;
  if (!tomeNum) {
    const numMatch = rawUri.match(/(\d+)/);
    tomeNum = numMatch ? parseInt(numMatch[1], 10) : 1;
  }

  const archiveFilename = `de_LTBUP_${tomeNum}.cbz`;
  const finalCbzPath = path.join(targetDir, archiveFilename);

  // Staging folder placed in OS temp dir (completely outside git) with clean naming
  const tempFolder = path.join(os.tmpdir(), 'archiving-helper', `staging_de_LTBUP_${tomeNum}`);
  fs.mkdirSync(tempFolder, { recursive: true });

  const startTime = Date.now();
  console.log(`\n========================================================`);
  console.log(`  Archive Cible : ${archiveFilename}`);
  console.log(`  Destination   : ${targetDir}`);
  console.log(`  Source URI    : ${rawUri}`);
  console.log(`  Mode          : Lossless (100% sans perte de qualité)`);
  console.log(`  Temp Staging  : ${tempFolder} (hors git)`);
  console.log(`  Nomenclature  : de_LTBUP_${tomeNum}_1.jpg, de_LTBUP_${tomeNum}_2.jpg...`);
  console.log(`========================================================`);

  try {
    const apiUrl = `https://comicmafia.to/reader/comic_pages.php?bookUri=${encodeURIComponent(encodeURIComponent(rawUri))}`;
    const res = await safeFetch(apiUrl, {
      headers: { 'Accept': 'application/json, text/javascript, */*; q=0.01' }
    });

    const json = await res.json();
    if (json.status !== 'success' || !json.urls) {
      throw new Error(`Comic pages API returned error for URI: ${rawUri}`);
    }

    const pageKeys = Object.keys(json.urls).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const totalPages = pageKeys.length;
    console.log(`[+] Total pages à télécharger : ${totalPages}`);

    // High-performance worker pool concurrency (8-10 concurrent downloads)
    const CONCURRENCY = options.concurrency || 8;
    const pageBuffers = new Map();
    let downloadedCount = 0;
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < totalPages) {
        const currentIdx = nextIndex++;
        const pageKey = pageKeys[currentIdx];
        const rawPath = decodeURIComponent(json.urls[pageKey]);
        const imgUrl = rawPath.startsWith('http') ? rawPath : `https://comicmafia.to${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;
        const pageNum = parseInt(pageKey, 10) + 1;

        const imgRes = await safeFetch(imgUrl);
        const rawBuffer = Buffer.from(await imgRes.arrayBuffer());
        const optimizedBuffer = cleanJpegLossless(rawBuffer);

        pageBuffers.set(pageNum, optimizedBuffer);
        downloadedCount++;

        const percent = Math.round((downloadedCount / totalPages) * 100);
        const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
        const pagesPerSec = (downloadedCount / elapsedSec).toFixed(1);
        process.stdout.write(`\r[*] Progression : ${downloadedCount}/${totalPages} pages (${percent}%) - ${pagesPerSec} p/s`);
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, totalPages) }, () => worker());
    await Promise.all(workers);

    const downloadDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[+] Téléchargement terminé en ${downloadDuration}s (${(totalPages / downloadDuration).toFixed(1)} pages/sec).`);
    console.log(`[*] Empaquetage direct dans l'archive CBZ : ${archiveFilename}...`);

    const zip = new AdmZip();
    for (let p = 1; p <= totalPages; p++) {
      const entryName = `de_LTBUP_${tomeNum}_${p}.jpg`;
      const buffer = pageBuffers.get(p);
      if (buffer) {
        zip.addFile(entryName, buffer);
      }
    }

    zip.writeZip(finalCbzPath);

    const stats = fs.statSync(finalCbzPath);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[+] SUCCÈS ! Archive prête : ${finalCbzPath} (${sizeMb} Mo en ${totalDuration}s)\n`);
    return finalCbzPath;

  } finally {
    // Guaranteed cleanup of temp folder
    try {
      if (fs.existsSync(tempFolder)) {
        fs.rmSync(tempFolder, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}
