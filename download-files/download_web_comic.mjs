import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // Target archive name: de_LTBUP_XX.cbr (e.g. de_LTBUP_48.cbr)
  const archiveFilename = `de_LTBUP_${tomeNum}.cbr`;
  const finalCbrPath = path.join(outputDir, archiveFilename);

  console.log(`\n========================================================`);
  console.log(`  Archive Cible : ${archiveFilename}`);
  console.log(`  Source URI    : ${rawUri}`);
  console.log(`  Images int.   : de_LTBUP_${tomeNum}_1.jpg, de_LTBUP_${tomeNum}_2.jpg...`);
  console.log(`========================================================`);

  // Fetch page list from ComicMafia API
  const apiUrl = `https://comicmafia.to/reader/comic_pages.php?bookUri=${encodeURIComponent(encodeURIComponent(rawUri))}`;
  const res = await fetch(apiUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
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

  // Download all pages concurrently in batches of 12
  const CONCURRENCY = 12;
  let downloadedCount = 0;

  async function downloadPage(idx) {
    const rawPath = decodeURIComponent(json.urls[idx]);
    const imgUrl = rawPath.startsWith('http') ? rawPath : `https://comicmafia.to${rawPath.startsWith('/') ? '' : '/'}${rawPath}`;
    const ext = path.extname(imgUrl) || '.jpg';
    const pageNum = parseInt(idx, 10) + 1;
    
    // Internal image naming: de_LTBUP_48_1.jpg, de_LTBUP_48_2.jpg (unpadded)
    const entryName = `de_LTBUP_${tomeNum}_${pageNum}${ext}`;
    const localFile = path.join(tempFolder, entryName);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const imgRes = await fetch(imgUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://comicmafia.to/' }
        });
        if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        fs.writeFileSync(localFile, buffer);
        downloadedCount++;
        process.stdout.write(`\r[*] Progression : ${downloadedCount}/${totalPages} pages (${Math.round((downloadedCount/totalPages)*100)}%)`);
        return;
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  for (let i = 0; i < totalPages; i += CONCURRENCY) {
    const batch = [];
    for (let j = i; j < Math.min(i + CONCURRENCY, totalPages); j++) {
      batch.push(downloadPage(pageKeys[j]));
    }
    await Promise.all(batch);
  }

  console.log(`\n[*] Empaquetage dans l'archive : ${archiveFilename}...`);

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
