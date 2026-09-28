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
 * Heuristic rules to infer a clean standardized comic name (e.g. de_LTBUP_48, fr_DDD_1)
 * from messy/anonymized filenames, internal ComicInfo.xml, or internal image names.
 */
export function inferStandardizedName(filename, internalFiles = [], comicInfoXml = null) {
  const combinedText = `${filename} ${internalFiles.slice(0, 5).join(' ')} ${comicInfoXml || ''}`.toLowerCase();
  
  // Extract number (volume/issue number)
  let num = null;
  const numMatches = [
    filename.match(/(?:tome|vol|issue|no|nr|#|part|_)[\s._-]*(\d+)/i),
    filename.match(/(?:phantomias|donald|mickey|picsou|duck|irs|ddd|jmc|ltbup|ltb)[\s._-]*(\d+)/i),
    combinedText.match(/(?:u|ddd|jmc|irs|ltb)[\s._-]*(\d+)/i),
    filename.match(/(\d+)/)
  ];
  for (const m of numMatches) {
    if (m && m[1]) {
      num = parseInt(m[1], 10);
      break;
    }
  }

  // 1. Lustiges Taschenbuch Ultimate Phantomias (de_LTBUP)
  if (/ultimate[\s._-]*phantomias|ltb[\s._-]*ultimate|phantomias|chronik[\s._-]*eines[\s._-]*superhelden|u\d+_\d+/i.test(combinedText)) {
    return num ? `de_LTBUP_${num}` : `de_LTBUP_1`;
  }

  // 2. Dynastie Donald Duck (fr_DDD)
  if (/dynastie[\s._-]*donald|carl[\s._-]*barks[\s._-]*integral|fr_ddd|ddd[\s._-]*\d+/i.test(combinedText)) {
    return num ? `fr_DDD_${num}` : `fr_DDD_1`;
  }

  // 3. Journal de Mickey Collector / Classique (fr_JMC)
  if (/journal[\s._-]*de[\s._-]*mickey|jmc[\s._-]*\d+|fr_jmc/i.test(combinedText)) {
    return num ? `fr_JMC_${num}` : `fr_JMC_1`;
  }

  // 4. Intégrale Don Rosa / Grande Épopée de Picsou (fr_IRS)
  if (/don[\s._-]*rosa|grande[\s._-]*epopee[\s._-]*de[\s._-]*picsou|fr_irs|irs[\s._-]*\d+/i.test(combinedText)) {
    return num ? `fr_IRS_${num}` : `fr_IRS_1`;
  }

  // 5. Fantomiald / Powerduck (fr_POWERDUCK / fr_FAN)
  if (/powerduck|fantomiald/i.test(combinedText)) {
    return num ? `fr_POWERDUCK_${num}` : `fr_POWERDUCK_1`;
  }

  // 6. Uncle Scrooge / Carl Barks US (us_USCA)
  if (/uncle[\s._-]*scrooge|carl[\s._-]*barks[\s._-]*library|us_usca/i.test(combinedText)) {
    return num ? `us_USCA_${num}` : `us_USCA_1`;
  }

  // 7. Pato Donald (pt_PD / es_PD)
  if (/pato[\s._-]*donald|pt_pd/i.test(combinedText)) {
    return num ? `pt_PD_${num}` : `pt_PD_1`;
  }

  // 8. Mickey Parade Géant (fr_MPG)
  if (/mickey[\s._-]*parade|mpg/i.test(combinedText)) {
    return num ? `fr_MPG_${num}` : `fr_MPG_1`;
  }

  // 9. Super Picsou Géant (fr_SPG)
  if (/super[\s._-]*picsou|spg/i.test(combinedText)) {
    return num ? `fr_SPG_${num}` : `fr_SPG_1`;
  }

  // 10. Picsou Magazine (fr_PM)
  if (/picsou[\s._-]*magazine|fr_pm/i.test(combinedText)) {
    return num ? `fr_PM_${num}` : `fr_PM_1`;
  }

  // Fallback: clean the original basename
  let cleaned = path.parse(filename).name;
  cleaned = cleaned.replace(/--\s*[a-f0-9]{32,}\s*--.*/i, ''); // remove hashes
  cleaned = cleaned.replace(/[a-f0-9]{32,}/i, '');
  cleaned = cleaned.replace(/_?\s*anna’s archive.*/i, '');
  cleaned = cleaned.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || `comic_${num || 1}`;
}

/**
 * Repairs, de-anonymizes and repacks a folder/archive into a clean CBR
 */
export async function repairAndRepackToCbr(inputPath, outputDir = 'C:\\Users\\starl\\Downloads\\Repaired_CBR') {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const stat = fs.statSync(inputPath);
  const rawBaseName = path.parse(inputPath).name;

  const tempStaging = path.join(outputDir, `_staging_${Date.now()}`);
  fs.mkdirSync(tempStaging, { recursive: true });

  const rawImageEntries = [];
  let detectedComicInfo = null;

  try {
    if (stat.isDirectory()) {
      function getAllImagesFromFolder(dir) {
        let imgs = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            imgs = imgs.concat(getAllImagesFromFolder(full));
          } else if (/\.(jpe?g|png|webp|gif|bmp)$/i.test(ent.name)) {
            imgs.push(full);
          } else if (/comicinfo\.xml/i.test(ent.name)) {
            try { detectedComicInfo = fs.readFileSync(full, 'utf8'); } catch(e) {}
          }
        }
        return imgs;
      }

      const files = getAllImagesFromFolder(inputPath);
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
          if (/comicinfo\.xml/i.test(e.entryName)) {
            try { detectedComicInfo = e.getData().toString('utf8'); } catch(e) {}
          } else if (!e.isDirectory && /\.(jpe?g|png|webp|gif)$/i.test(e.entryName)) {
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
            } else if (/comicinfo\.xml/i.test(item.name)) {
              try { detectedComicInfo = fs.readFileSync(full, 'utf8'); } catch(e) {}
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

    // Determine clean standardized name (De-anonymization)
    const internalFilenames = rawImageEntries.map(e => e.originalName);
    const standardBaseName = inferStandardizedName(rawBaseName, internalFilenames, detectedComicInfo);
    const finalCbrPath = path.join(outputDir, `${standardBaseName}.cbr`);

    console.log(`\n========================================================`);
    console.log(`  [SOURCE ANONYMISÉE] : ${path.basename(inputPath)}`);
    console.log(`  [NOM STANDARDISÉ]   : ${standardBaseName}.cbr`);
    console.log(`  [PAGES EXTRAITES]   : ${rawImageEntries.length}`);
    console.log(`========================================================`);

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
    console.log(`[+] SUCCÈS ! Fichier standardisé : ${finalCbrPath} (${sizeMb} Mo)\n`);
    return finalCbrPath;

  } finally {
    fs.rmSync(tempStaging, { recursive: true, force: true });
  }
}

// Test on real anonymized / messy files
async function runAutoDeAnonymize() {
  const testFiles = [
    'C:\\Users\\starl\\Downloads\\Telegram Desktop\\Fantomiald_Les_Chroniques_De_HS_powerduck_01_les_aventures_galactiques.cbr',
    'C:\\Users\\starl\\Downloads\\Pato Donald -#10-Ed_ Primavera- x Ricopa_crg_cbr -- 32682872cce1e512a2dd7032eaa0ce58 -- Anna’s Archive.cbr',
    'C:\\Users\\starl\\Downloads\\us_USCA_2.cbz'
  ];

  console.log('========================================================');
  console.log('  Désanonymisation & Standardisation Automatique');
  console.log('========================================================\n');

  for (const f of testFiles) {
    if (fs.existsSync(f)) {
      try {
        await repairAndRepackToCbr(f);
      } catch (err) {
        console.error(`[!] Erreur sur ${f}:`, err.message);
      }
    }
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
  } else {
    runAutoDeAnonymize();
  }
}
