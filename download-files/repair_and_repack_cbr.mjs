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
 * Official INDUCKS Publication Codes (Strictly Verified, No Invented Acronyms)
 * Reference: https://inducks.org/
 */
const VERIFIED_INDUCK_CODES = [
  // France (fr)
  { regex: /dynastie[\s._-]*donald|carl[\s._-]*barks[\s._-]*integral|fr_ddd/i, code: 'fr_DDD' },         // La Dynastie Donald Duck
  { regex: /journal[\s._-]*de[\s._-]*mickey[\s._-]*collector|jmc/i, code: 'fr_JMC' },                    // Le Journal de Mickey Collector
  { regex: /journal[\s._-]*de[\s._-]*mickey|jdm/i, code: 'fr_JM' },                                      // Le Journal de Mickey
  { regex: /grande[\s._-]*epopee[\s._-]*de[\s._-]*picsou|don[\s._-]*rosa[\s._-]*integral|fr_irs/i, code: 'fr_IRS' }, // Intégrale Don Rosa
  { regex: /chroniques[\s._-]*de[\s._-]*fantomiald|fr_cf/i, code: 'fr_CF' },                              // Les Chroniques de Fantomiald
  { regex: /powerduck|pkna|power[\s._-]*duck/i, code: 'fr_PKNA' },                                       // Powerduck (PKNA / Paperinik New Adventures)
  { regex: /mickey[\s._-]*parade[\s._-]*geant|fr_mpg/i, code: 'fr_MPG' },                                // Mickey Parade Géant
  { regex: /super[\s._-]*picsou[\s._-]*geant|fr_spg/i, code: 'fr_SPG' },                                // Super Picsou Géant
  { regex: /picsou[\s._-]*magazine|fr_pm/i, code: 'fr_PM' },                                             // Picsou Magazine
  { regex: /fantomiald[\s._-]*hors[\s._-]*serie|fr_fhs/i, code: 'fr_FHS' },                              // Fantomiald Hors-Série
  { regex: /les[\s._-]*tresors[\s._-]*de[\s._-]*picsou|fr_tp/i, code: 'fr_TP' },                         // Les Trésors de Picsou

  // Germany (de)
  { regex: /ultimate[\s._-]*phantomias|ltb[\s._-]*ultimate|de_ltbup/i, code: 'de_LTBUP' },               // LTB Ultimate Phantomias
  { regex: /lustiges[\s._-]*taschenbuch|ltb/i, code: 'de_LTB' },                                         // Lustiges Taschenbuch
  { regex: /micky[\s._-]*maus/i, code: 'de_MM' },                                                        // Micky Maus

  // Brazil (br - Official Inducks country code for Brazil)
  { regex: /pato[\s._-]*donald/i, code: 'br_PD' },                                                       // Pato Donald (Editora Abril)
  { regex: /tio[\s._-]*patinhas/i, code: 'br_TP' },                                                      // Tio Patinhas
  { regex: /ze[\s._-]*carioca/i, code: 'br_ZC' },                                                        // Zé Carioca

  // United States (us)
  { regex: /uncle[\s._-]*scrooge[\s._-]*carl[\s._-]*barks|us_usca/i, code: 'us_USCA' },                 // Uncle Scrooge (Carl Barks)
  { regex: /uncle[\s._-]*scrooge/i, code: 'us_US' },                                                     // Uncle Scrooge
  { regex: /walt[\s._-]*disney[\s._-]*comics[\s._-]*and[\s._-]*stories|wdcs/i, code: 'us_WDC' },        // WDC&S

  // Italy (it)
  { regex: /topolino/i, code: 'it_TL' },                                                                 // Topolino
  { regex: /paperino/i, code: 'it_PA' }                                                                  // Paperino
];

/**
 * Standardizes filename using ONLY verified Inducks codes.
 * If not matching a verified Inducks code, cleans the original title without inventing fake codes.
 */
export function inferStandardizedName(filename, internalFiles = [], comicInfoXml = null) {
  const combinedText = `${filename} ${internalFiles.slice(0, 5).join(' ')} ${comicInfoXml || ''}`.toLowerCase();
  
  // Extract issue/volume number
  let num = null;
  const numMatches = [
    filename.match(/(?:tome|vol|issue|no|nr|#|part|_)[\s._-]*(\d+)/i),
    filename.match(/(?:phantomias|donald|mickey|picsou|duck|irs|ddd|jmc|ltbup|ltb|powerduck)[\s._-]*(\d+)/i),
    combinedText.match(/(?:u|ddd|jmc|irs|ltb|pkna|cf)[\s._-]*(\d+)/i),
    filename.match(/(\d+)/)
  ];
  for (const m of numMatches) {
    if (m && m[1]) {
      num = parseInt(m[1], 10);
      break;
    }
  }

  // 1. Check against strictly verified Inducks catalog codes
  for (const entry of VERIFIED_INDUCK_CODES) {
    if (entry.regex.test(combinedText)) {
      return num ? `${entry.code}_${num}` : `${entry.code}_1`;
    }
  }

  // 2. If no official Inducks code matches, do NOT invent one: clean the real title cleanly
  let cleaned = path.parse(filename).name;
  cleaned = cleaned.replace(/--\s*[a-f0-9]{32,}\s*--.*/i, ''); // strip hashes
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

    // Determine clean standardized name (Verified Inducks code or clean title)
    const internalFilenames = rawImageEntries.map(e => e.originalName);
    const standardBaseName = inferStandardizedName(rawBaseName, internalFilenames, detectedComicInfo);
    const finalCbrPath = path.join(outputDir, `${standardBaseName}.cbr`);

    console.log(`\n========================================================`);
    console.log(`  [SOURCE]            : ${path.basename(inputPath)}`);
    console.log(`  [CODE INDUCKS OFF.] : ${standardBaseName}.cbr`);
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

// CLI execution
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
