import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://comicmafia.to/reader/comic-viewer.html',
  'Sec-Fetch-Dest': 'image',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Site': 'same-origin'
};

// 100% Lossless JPEG metadata cleaner (strips useless APP/EXIF/comment markers without touching any pixels/DCT coefficients)
function optimizeJpegLossless(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return buf; // not a JPEG
  const chunks = [Buffer.from([0xFF, 0xD8])];
  let offset = 2;
  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xFF) {
      chunks.push(buf.subarray(offset));
      break;
    }
    const marker = buf[offset + 1];
    if (marker === 0xDA) { // Start of Spectral Scan
      chunks.push(buf.subarray(offset));
      break;
    }
    if (marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      chunks.push(buf.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const len = buf.readUInt16BE(offset + 2);
    // Strip APP1..APP15 metadata & Comments (0xFE)
    const isAppOrComment = (marker >= 0xE1 && marker <= 0xEF) || marker === 0xFE;
    if (!isAppOrComment) {
      chunks.push(buf.subarray(offset, offset + 2 + len));
    }
    offset += 2 + len;
  }
  return Buffer.concat(chunks);
}

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

export async function downloadWebComic(bookUri, outputDir = path.resolve(__dirname, 'files_downloads'), customTomeNum = null) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Parse URI if full URL was passed
  let rawUri = bookUri;
  if (rawUri.includes('bookUri=')) {
    const m = rawUri.match(/bookUri=([^&]+)/);
    if (m) rawUri = decodeURIComponent(decodeURIComponent(m[1]));
  }

  // Determine tome number (e.g. 48)
  let tomeNum = customTomeNum;
  if (!tomeNum) {
    const numMatch = rawUri.match(/(\d+)/);
    tomeNum = numMatch ? parseInt(numMatch[1], 10) : 1;
  }

  const archiveFilename = `de_LTBUP_${tomeNum}.cbr`;
  const finalCbrPath = path.join(outputDir, archiveFilename);

  console.log(`\n========================================================`);
  console.log(`  Archive Cible : ${archiveFilename}`);
  console.log(`  Source URI    : ${rawUri}`);
  console.log(`  Mode          : Lossless (100% sans perte de qualité)`);
  console.log(`  Nomenclature  : de_LTBUP_${tomeNum}_1.jpg, de_LTBUP_${tomeNum}_2.jpg...`);
  console.log(`========================================================`);

  // Fetch page list from ComicMafia API with safe retry
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

  const tempFolder = path.join(outputDir, `_temp_${tomeNum}_${Date.now()}`);
  fs.mkdirSync(tempFolder, { recursive: true });

  // Concurrency (4 streams) with lossless cleaning
  const CONCURRENCY = 4;
  let downloadedCount = 0;

  async function downloadPage(idx) {
    const rawPath = decodeURIComponent(json.urls[idx]);
    const imgUrl = rawPath.startsWith('http') ? rawPath : `https://comicmafia.to${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;
    const ext = path.extname(imgUrl) || '.jpg';
    const pageNum = parseInt(idx, 10) + 1;
    
    // Internal image naming: de_LTBUP_XX_Y.jpg
    const entryName = `de_LTBUP_${tomeNum}_${pageNum}${ext}`;
    const localFile = path.join(tempFolder, entryName);

    if (fs.existsSync(localFile) && fs.statSync(localFile).size > 1000) {
      downloadedCount++;
      return;
    }

    const imgRes = await safeFetch(imgUrl);
    const rawBuffer = Buffer.from(await imgRes.arrayBuffer());
    
    // Lossless cleaning: strips useless EXIF/APP markers without touching pixel data
    const optimizedBuffer = optimizeJpegLossless(rawBuffer);
    
    fs.writeFileSync(localFile, optimizedBuffer);
    downloadedCount++;
    process.stdout.write(`\r[*] Progression : ${downloadedCount}/${totalPages} pages (${Math.round((downloadedCount/totalPages)*100)}%)`);
    
    // Micro delay between requests
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
  // Sort files numerically by page number (1, 2, 3... 10... 100) before adding to ZIP
  for (let p = 1; p <= totalPages; p++) {
    const entryName = `de_LTBUP_${tomeNum}_${p}.jpg`;
    const fullPath = path.join(tempFolder, entryName);
    if (fs.existsSync(fullPath)) {
      zip.addLocalFile(fullPath);
    }
  }

  zip.writeZip(finalCbrPath);

  // Clean temp folder
  fs.rmSync(tempFolder, { recursive: true, force: true });

  const stats = fs.statSync(finalCbrPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
  console.log(`[+] SUCCÈS ! Fichier prêt : ${finalCbrPath} (${sizeMb} Mo)\n`);
  return finalCbrPath;
}

// If executed directly from CLI
if (process.argv[1] && process.argv[1].endsWith('download_web_comic.mjs')) {
  const uriArg = process.argv[2] || 'Alben/UltimatePhantomias48.cbr';
  downloadWebComic(uriArg)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n[!] Erreur:', err.message);
      process.exit(1);
    });
}
