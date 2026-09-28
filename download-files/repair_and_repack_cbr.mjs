import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Natural alphanumeric sort (1, 2, 3... 10... 100)
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// 100% Lossless JPEG cleaner
function cleanJpegLossless(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return buf;
  const chunks = [Buffer.from([0xFF, 0xD8])];
  let offset = 2;
  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xFF) {
      chunks.push(buf.subarray(offset));
      break;
    }
    const marker = buf[offset + 1];
    if (marker === 0xDA) { // Start of scan
      chunks.push(buf.subarray(offset));
      break;
    }
    if (marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) {
      chunks.push(buf.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 4 > buf.length) break;
    const len = buf.readUInt16BE(offset + 2);
    const isAppOrComment = (marker >= 0xE1 && marker <= 0xEF) || marker === 0xFE;
    if (!isAppOrComment) {
      chunks.push(buf.subarray(offset, offset + 2 + len));
    }
    offset += 2 + len;
  }
  return Buffer.concat(chunks);
}

/**
 * Repairs a folder, single archive, or multi-part archive (.part1.rar, .001, etc.) into a clean CBR
 */
export async function repairAndRepackToCbr(inputPath, outputDir = 'C:\\Users\\starl\\Downloads\\Repaired_CBR') {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const stat = fs.statSync(inputPath);
  
  // Clean base name by stripping .part1, .001, etc. for unified output
  let baseName = path.parse(inputPath).name;
  baseName = baseName.replace(/(\.part\d+|\.00\d+|\.vol\d+\+\d+)$/i, '');
  baseName = baseName.replace(/[-_ ]part[-_ ]?\d+$/i, '');

  const finalCbrPath = path.join(outputDir, `${baseName}.cbr`);

  console.log(`\n========================================================`);
  console.log(`  [SOURCE]      : ${path.basename(inputPath)}`);
  console.log(`  [DESTINATION] : ${finalCbrPath}`);
  console.log(`========================================================`);

  const tempStaging = path.join(outputDir, `_staging_${Date.now()}`);
  fs.mkdirSync(tempStaging, { recursive: true });

  const imageBuffers = [];

  try {
    if (stat.isDirectory()) {
      // Input is a folder of images or subfolders
      function getAllImagesFromFolder(dir) {
        let imgs = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            imgs = imgs.concat(getAllImagesFromFolder(full));
          } else if (/\.(jpe?g|png|webp|gif|bmp)$/i.test(ent.name)) {
            imgs.push(full);
          }
        }
        return imgs;
      }

      const files = getAllImagesFromFolder(inputPath);
      files.sort((a, b) => naturalSort(path.basename(a), path.basename(b)));
      console.log(`[+] Images trouvées dans le dossier : ${files.length}`);

      for (let i = 0; i < files.length; i++) {
        const buf = fs.readFileSync(files[i]);
        const cleaned = cleanJpegLossless(buf);
        const ext = path.extname(files[i]) || '.jpg';
        const targetName = `${baseName}_${i + 1}${ext}`;
        imageBuffers.push({ name: targetName, buffer: cleaned });
      }

    } else {
      // Input is an archive (Single or Multi-part)
      const extractTemp = path.join(tempStaging, 'extracted');
      fs.mkdirSync(extractTemp, { recursive: true });

      // Check if multi-part file (.part1.rar, .001, .z01, etc.)
      const isMultiPart = /(\.part\d+\.rar|\.\d{3}|\.r\d{2}|\.z\d{2})$/i.test(inputPath);
      if (isMultiPart) {
        console.log(`[!] Détection d'archive MULTI-PARTIES : Reconstitution automatique...`);
      }

      const rawBuf = fs.readFileSync(inputPath);
      const isZip = rawBuf.subarray(0, 4).toString('hex') === '504b0304';

      if (isZip && !isMultiPart) {
        const zip = new AdmZip(inputPath);
        const entries = zip.getEntries().filter(e => !e.isDirectory && /\.(jpe?g|png|webp|gif)$/i.test(e.entryName));
        entries.sort((a, b) => naturalSort(a.entryName, b.entryName));
        console.log(`[+] Images extraites de l'archive ZIP : ${entries.length}`);

        for (let i = 0; i < entries.length; i++) {
          const buf = entries[i].getData();
          const cleaned = cleanJpegLossless(buf);
          const ext = path.extname(entries[i].entryName) || '.jpg';
          const targetName = `${baseName}_${i + 1}${ext}`;
          imageBuffers.push({ name: targetName, buffer: cleaned });
        }
      } else {
        // Multi-part or RAR/7z: use system extractors (tar, 7z)
        console.log(`[*] Extraction et assemblage des parties en cours...`);
        let extracted = false;

        // Try 7-Zip first (best for multi-part .part1.rar / .001 / .r00)
        try {
          execSync(`7z x -y -o"${extractTemp}" "${inputPath}"`, { stdio: 'ignore' });
          extracted = true;
        } catch (e) {
          // Fallback to tar
          try {
            execSync(`tar -xf "${inputPath}" -C "${extractTemp}"`, { stdio: 'ignore' });
            extracted = true;
          } catch(err) {}
        }

        function getFilesRecursive(dir) {
          let results = [];
          const list = fs.readdirSync(dir, { withFileTypes: true });
          for (const item of list) {
            const full = path.join(dir, item.name);
            if (item.isDirectory()) {
              results = results.concat(getFilesRecursive(full));
            } else if (/\.(jpe?g|png|webp|gif|bmp)$/i.test(item.name)) {
              results.push(full);
            }
          }
          return results;
        }

        const foundImages = getFilesRecursive(extractTemp);
        foundImages.sort((a, b) => naturalSort(path.basename(a), path.basename(b)));
        console.log(`[+] Images extraites de toutes les parties réunies : ${foundImages.length}`);

        for (let i = 0; i < foundImages.length; i++) {
          const buf = fs.readFileSync(foundImages[i]);
          const cleaned = cleanJpegLossless(buf);
          const ext = path.extname(foundImages[i]) || '.jpg';
          const targetName = `${baseName}_${i + 1}${ext}`;
          imageBuffers.push({ name: targetName, buffer: cleaned });
        }
      }
    }

    if (imageBuffers.length === 0) {
      throw new Error(`Aucune image récupérable trouvée dans ${inputPath}`);
    }

    console.log(`[*] Empaquetage dans l'archive CBR unifiée (${path.basename(finalCbrPath)})...`);
    const newZip = new AdmZip();
    for (const img of imageBuffers) {
      newZip.addFile(img.name, img.buffer);
    }
    newZip.writeZip(finalCbrPath);

    const outStat = fs.statSync(finalCbrPath);
    const sizeMb = (outStat.size / (1024 * 1024)).toFixed(1);
    console.log(`[+] SUCCÈS ! Archive finale assemblée : ${finalCbrPath} (${sizeMb} Mo, ${imageBuffers.length} pages)\n`);
    return finalCbrPath;

  } finally {
    fs.rmSync(tempStaging, { recursive: true, force: true });
  }
}

// Interactive CLI or direct argument
if (process.argv[1] && process.argv[1].endsWith('repair_and_repack_cbr.mjs')) {
  const arg = process.argv[2];
  if (arg && fs.existsSync(arg)) {
    repairAndRepackToCbr(arg)
      .then(() => process.exit(0))
      .catch(err => {
        console.error('\n[!] Erreur:', err.message);
        process.exit(1);
      });
  }
}
