import fs from 'fs';
import path from 'path';
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
        const waitTime = attempt * 10;
        console.warn(`\n[!] Rate-limit détecté (HTTP 429). Pause de sécurité de ${waitTime}s avant reprise...`);
        await new Promise(r => setTimeout(r, waitTime * 1000));
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

/**
 * Downloads a comic from an online reader (ComicMafia) and packages it directly into a clean CBR
 */
export async function downloadWebComic(bookUri, outputDir, customTomeNum = null) {
  const targetDir = outputDir || path.resolve('files_downloads');
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

  const archiveFilename = `de_LTBUP_${tomeNum}.cbr`;
  const finalCbrPath = path.join(targetDir, archiveFilename);

  console.log(`\n========================================================`);
  console.log(`  Archive Cible : ${archiveFilename}`);
  console.log(`  Source URI    : ${rawUri}`);
  console.log(`  Mode          : Lossless (100% sans perte de qualité)`);
  console.log(`  Nomenclature  : de_LTBUP_${tomeNum}_1.jpg, de_LTBUP_${tomeNum}_2.jpg...`);
  console.log(`========================================================`);

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

  const tempFolder = path.join(targetDir, `_temp_${tomeNum}_${Date.now()}`);
  fs.mkdirSync(tempFolder, { recursive: true });

  const CONCURRENCY = 4;
  let downloadedCount = 0;

  async function downloadPage(idx) {
    const rawPath = decodeURIComponent(json.urls[idx]);
    const imgUrl = rawPath.startsWith('http') ? rawPath : `https://comicmafia.to${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;
    const ext = path.extname(imgUrl) || '.jpg';
    const pageNum = parseInt(idx, 10) + 1;
    
    const entryName = `de_LTBUP_${tomeNum}_${pageNum}${ext}`;
    const localFile = path.join(tempFolder, entryName);

    if (fs.existsSync(localFile) && fs.statSync(localFile).size > 1000) {
      downloadedCount++;
      return;
    }

    const imgRes = await safeFetch(imgUrl);
    const rawBuffer = Buffer.from(await imgRes.arrayBuffer());
    const optimizedBuffer = cleanJpegLossless(rawBuffer);
    
    fs.writeFileSync(localFile, optimizedBuffer);
    downloadedCount++;
    process.stdout.write(`\r[*] Progression : ${downloadedCount}/${totalPages} pages (${Math.round((downloadedCount/totalPages)*100)}%)`);
    
    await new Promise(r => setTimeout(r, 50));
  }

  for (let i = 0; i < totalPages; i += CONCURRENCY) {
    const batch = [];
    for (let j = i; j < Math.min(i + CONCURRENCY, totalPages); j++) {
      batch.push(downloadPage(pageKeys[j]));
    }
    await Promise.all(batch);
  }

  console.log(`\n[*] Empaquetage dans l'archive CBR : ${archiveFilename}...`);

  const zip = new AdmZip();
  for (let p = 1; p <= totalPages; p++) {
    const entryName = `de_LTBUP_${tomeNum}_${p}.jpg`;
    const fullPath = path.join(tempFolder, entryName);
    if (fs.existsSync(fullPath)) {
      zip.addLocalFile(fullPath);
    }
  }

  zip.writeZip(finalCbrPath);
  fs.rmSync(tempFolder, { recursive: true, force: true });

  const stats = fs.statSync(finalCbrPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
  console.log(`[+] SUCCÈS ! Fichier prêt : ${finalCbrPath} (${sizeMb} Mo)\n`);
  return finalCbrPath;
}
