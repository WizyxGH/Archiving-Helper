import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { colorize } from '../../core/terminal.mjs';
import { resolveInducksPublication } from '../../core/inducks/inducks.mjs';
import { storeArchive } from '../3_storage_backup/storage.mjs';
import { verifyArchive } from '../2_standardisation/verify_archive.mjs';
import { updateCollectionCsv, getCollectionDirectory } from '../5_sheets_update/collection_csv.mjs';
import { prepareInducksUpload } from '../6_inducks_upload/prepare.mjs';

const __filename = fileURLToPath(import.meta.url);

async function hashArchive(archivePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function registerArchivedComic(archivePath, options = {}) {
  const sourcePath = path.resolve(archivePath);
  const sourceStat = fs.statSync(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size === 0) {
    throw new Error(`Archive is missing or empty: ${sourcePath}`);
  }

  const inducks = options.inducks || await resolveInducksPublication(path.basename(sourcePath));
  const verification = verifyArchive(sourcePath);
  const archiveHash = await hashArchive(sourcePath);
  let storage = { archivePath: sourcePath, stored: false, reason: 'Issue is not certified or archive needs standardisation' };
  if (inducks.isCertified && verification.verified) storage = await storeArchive(sourcePath, inducks, archiveHash);

  const finalArchivePath = storage.archivePath;
  if (storage.reason && inducks.isCertified) {
    console.warn(colorize(`[!] Stockage Inducks ignoré : ${storage.reason}`, 'yellow'));
  } else if (storage.stored && !storage.duplicate) {
    console.log(colorize(`[+] Archive classée : ${finalArchivePath}`, 'green'));
  }

  const collectionDirectory = options.collectionDirectory || getCollectionDirectory();
  let uploadBundle = null;
  let uploadError = null;
  if (inducks.isCertified && verification.verified) {
    try {
      uploadBundle = prepareInducksUpload(finalArchivePath, inducks, archiveHash, collectionDirectory);
    } catch (error) {
      uploadError = error.message;
      console.warn(colorize(`[!] Préparation Inducks à reprendre : ${uploadError}`, 'yellow'));
    }
  }

  const finalStat = fs.statSync(finalArchivePath);
  const canonicalStem = inducks.canonicalStem || path.parse(sourcePath).name;
  const archiveFormat = path.extname(finalArchivePath).slice(1).toLowerCase();
  const status = !inducks.isCertified
    ? 'needs_inducks_review'
    : !verification.verified
      ? 'needs_standardisation'
    : uploadError
      ? 'upload_preparation_failed'
      : uploadBundle
        ? 'pending_confirmation'
        : 'registered_without_upload_bundle';

  const record = {
    collection_key: `${canonicalStem}|${archiveFormat}`,
    canonical_stem: canonicalStem,
    inducks_issue_code: inducks.issueCode || '',
    publication: inducks.matchedPublication?.title || '',
    issue_number: inducks.issueNumber || '',
    format: archiveFormat,
    archive_path: finalArchivePath,
    archive_size_bytes: finalStat.size,
    sha256: archiveHash,
    image_count: uploadBundle?.imageCount || verification.imageCount || inducks.issuePageCount || '',
    inducks_entry_order: (inducks.issueEntries || []).map((entry) => entry.position).join(';'),
    upload_bundle: uploadBundle?.path || '',
    status,
    updated_at: new Date().toISOString(),
  };

  const csvPath = updateCollectionCsv(record, collectionDirectory);
  console.log(colorize(`[+] Collection CSV actualisé : ${csvPath}`, 'green'));
  if (uploadBundle) {
    console.log(colorize(`[+] Paquet Inducks prêt (${uploadBundle.imageCount} images), confirmation requise : ${uploadBundle.path}`, 'cyan'));
  }

  return { archivePath: finalArchivePath, inducks, record, csvPath, uploadBundle, storage };
}

export async function registerArchivedComicSafely(archivePath, options = {}) {
  try {
    return await registerArchivedComic(archivePath, options);
  } catch (error) {
    console.error(colorize(`[!] Archive créée, mais mise à jour de collection impossible : ${error.message}`, 'red'));
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename && process.argv[2]) {
  registerArchivedComic(process.argv[2])
    .then((result) => console.log(JSON.stringify({ csvPath: result.csvPath, uploadBundle: result.uploadBundle?.path || null })))
    .catch((error) => {
      console.error(colorize(`[!] ${error.message}`, 'red'));
      process.exitCode = 1;
    });
}