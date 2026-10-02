import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { execSync } from 'child_process';
import { cleanJpegLossless } from './formats/jpeg.mjs';
import { naturalSort } from './sorter.mjs';
import { resolveInducksPublication } from './inducks/inducks.mjs';
import { registerArchivedComicSafely } from '../pipelines/4_inducks_collection/collection.mjs';

/**
 * Extracts the real standardized name directly from internal image filenames
 * e.g., 'us_CBCO_10_1.jpg' -> 'us_CBCO_10'
 */
export function extractRealNameFromImages(imageNames, defaultName) {
  for (const name of imageNames) {
    const match = name.match(/^([a-zA-Z]{2,3}_[a-zA-Z0-9]+_\d+)(?:_\d+)?\.(?:jpe?g|png|webp)$/i) ||
                  name.match(/^([a-zA-Z0-9_-]+)_[0-9]+\.(?:jpe?g|png|webp)$/i);
    if (match && match[1]) {
      if (!/^(page|image|img|scan|p)$/i.test(match[1])) {
        return match[1];
      }
    }
  }
  return defaultName;
}

/**
 * Repairs, de-anonymizes, cleans images losslessly and repacks a folder or archive into a clean CBZ
 */
export async function repairAndRepackToCbz(inputPath, outputDir = path.resolve(os.homedir(), 'Downloads')) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const stat = fs.statSync(inputPath);
  const rawBaseName = path.parse(inputPath).name;

  const tempStaging = path.join(os.tmpdir(), 'archiving-helper', `staging_repair_${Date.now()}`);
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

    // Determine canonical name: check internal image names first, then resolve with Inducks
    const internalFilenames = rawImageEntries.map(e => e.originalName);
    const extractedStem = extractRealNameFromImages(internalFilenames, rawBaseName);
    const inducks = await resolveInducksPublication(extractedStem);

    const standardBaseName = inducks.isCertified ? inducks.canonicalStem : extractedStem;
    const finalCbzPath = path.join(outputDir, `${standardBaseName}.cbz`);

    console.log(`\n========================================================`);
    console.log(`  [SOURCE]           : ${path.basename(inputPath)}`);
    console.log(`  [NOM CANONIQUE]    : ${standardBaseName}.cbz`);
    if (inducks.isCertified) {
      console.log(`  [INDUCK SÉRIE]     : ${inducks.matchedPublication.title}`);
    } else {
      console.log(`  [STATUT INDUCKS]   : Non répertorié avec certitude (nom d'origine préservé)`);
    }
    console.log(`  [PAGES EXTRAITES]  : ${rawImageEntries.length} planches`);
    console.log(`========================================================`);

    const newZip = new AdmZip();
    for (let i = 0; i < rawImageEntries.length; i++) {
      const item = rawImageEntries[i];
      const cleaned = cleanJpegLossless(item.buffer);
      const ext = path.extname(item.originalName) || '.jpg';
      const entryName = `${standardBaseName}_${i + 1}${ext}`;
      newZip.addFile(entryName, cleaned);
    }

    newZip.writeZip(finalCbzPath);
    const outStat = fs.statSync(finalCbzPath);
    const sizeMb = (outStat.size / (1024 * 1024)).toFixed(1);
    await registerArchivedComicSafely(finalCbzPath, { inducks });
    console.log(`[+] SUCCÈS ! Archive prête : ${finalCbzPath} (${sizeMb} Mo)\n`);
    return finalCbzPath;

  } finally {
    try {
      if (fs.existsSync(tempStaging)) {
        fs.rmSync(tempStaging, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}
