import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * Extracts the real name directly from the internal image filenames
 * e.g., 'us_CBCO_10_1.jpg' -> 'us_CBCO_10'
 */
export function extractRealNameFromImages(imageNames, defaultName) {
  for (const name of imageNames) {
    // Matches patterns like 'us_CBCO_10_1.jpg' or 'fr_DDD_1_1.jpg' or 'de_LTBUP_48_1.jpg'
    const match = name.match(/^([a-zA-Z]{2}_[a-zA-Z0-9]+_\d+)(?:_\d+)?\.(?:jpe?g|png|webp)$/i) ||
                  name.match(/^([a-zA-Z0-9_-]+)_[0-9]+\.(?:jpe?g|png|webp)$/i);
    if (match && match[1]) {
      // Avoid generic names like 'page_1'
      if (!/^(page|image|img|scan|p)$/i.test(match[1])) {
        return match[1];
      }
    }
  }
  return defaultName;
}

export async function repairAndRepackToCbr(inputPath, outputDir = 'C:\\Users\\starl\\Downloads\\Repaired_CBR') {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const stat = fs.statSync(inputPath);
  const rawBaseName = path.parse(inputPath).name;

  const tempStaging = path.join(outputDir, `_staging_${Date.now()}`);
  fs.mkdirSync(tempStaging, { recursive: true });

  const rawImageEntries = [];

  try {
    if (stat.isDirectory()) {
      function getAllImages(dir) {
        let imgs = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            imgs = imgs.concat(getAllImages(full));
          } else if (/\.(jpe?g|png|webp|gif|bmp)$/i.test(ent.name)) {
            imgs.push(full);
          }
        }
        return imgs;
      }

      const files = getAllImages(inputPath);
      files.sort((a, b) => naturalSort(path.basename(a), path.basename(b)));
      for (const f of files) {
        rawImageEntries.push({ originalName: path.basename(f), buffer: fs.readFileSync(f) });
      }

    } else {
      const isMultiPart = /(\.part\d+\.rar|\.\d{3}|\.r\d{2}|\.z\d{2})$/i.test(inputPath);
      const rawBuf = fs.readFileSync(inputPath);
      const isZip = rawBuf.subarray(0, 4).toString('hex') === '504b0304';

      if (isZip && !isMultiPart) {
        const zip = new AdmZip(inputPath);
        const entries = zip.getEntries();
        for (const e of entries) {
          if (!e.isDirectory && /\.(jpe?g|png|webp|gif)$/i.test(e.entryName)) {
            rawImageEntries.push({ originalName: path.basename(e.entryName), buffer: e.getData() });
          }
        }
        rawImageEntries.sort((a, b) => naturalSort(a.originalName, b.originalName));

      } else {
        const extractTemp = path.join(tempStaging, 'extracted');
        fs.mkdirSync(extractTemp, { recursive: true });

        try {
          execSync(`7z x -y -o"${extractTemp}" "${inputPath}"`, { stdio: 'ignore' });
        } catch (e) {
          try { execSync(`tar -xf "${inputPath}" -C "${extractTemp}"`, { stdio: 'ignore' }); } catch(err) {}
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

        const foundFiles = getFilesRecursive(extractTemp);
        foundFiles.sort((a, b) => naturalSort(path.basename(a), path.basename(b)));
        for (const f of foundFiles) {
          rawImageEntries.push({ originalName: path.basename(f), buffer: fs.readFileSync(f) });
        }
      }
    }

    if (rawImageEntries.length === 0) {
      throw new Error(`Aucune image récupérable trouvée dans ${inputPath}`);
    }

    // 1. Get real name directly from internal images!
    const internalFilenames = rawImageEntries.map(e => e.originalName);
    const standardBaseName = extractRealNameFromImages(internalFilenames, rawBaseName);
    const finalCbrPath = path.join(outputDir, `${standardBaseName}.cbr`);

    console.log(`\n========================================================`);
    console.log(`  [SOURCE ANONYME]   : ${path.basename(inputPath)}`);
    console.log(`  [NOM RÉEL EXTRAIT] : ${standardBaseName}.cbr`);
    console.log(`  [PAGES EXTRAITES]  : ${rawImageEntries.length}`);
    console.log(`========================================================`);

    // 2. Repack into clean CBR with natural order
    const newZip = new AdmZip();
    for (let i = 0; i < rawImageEntries.length; i++) {
      const item = rawImageEntries[i];
      const cleaned = cleanJpegLossless(item.buffer);
      const ext = path.extname(item.originalName) || '.jpg';
      const entryName = `${standardBaseName}_${i + 1}${ext}`;
      newZip.addFile(entryName, cleaned);
    }

    newZip.writeZip(finalCbrPath);
    const outStat = fs.statSync(finalCbrPath);
    const sizeMb = (outStat.size / (1024 * 1024)).toFixed(1);
    console.log(`[+] SUCCÈS ! Fichier restauré : ${finalCbrPath} (${sizeMb} Mo)\n`);
    return finalCbrPath;

  } finally {
    fs.rmSync(tempStaging, { recursive: true, force: true });
  }
}

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
