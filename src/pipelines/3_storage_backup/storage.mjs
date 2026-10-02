import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { targetArchivePath } from '../../core/config.mjs';

/**
 * Racine d'archivage. TARGET_ARCHIVE_PATH dans l'environnement ou le .env,
 * sinon le défaut centralisé (voir core/config.mjs).
 */
function getTargetRoot() {
  return targetArchivePath();
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function storeArchive(archivePath, inducks, archiveHash) {
  if (!inducks?.isCertified || !inducks.relativeDirectory) {
    return { archivePath, stored: false, reason: 'Inducks issue is not certified' };
  }

  const targetRoot = getTargetRoot();
  const volumeRoot = path.parse(targetRoot).root;
  if (!fs.existsSync(volumeRoot)) {
    return { archivePath, stored: false, reason: `Storage volume unavailable: ${volumeRoot}` };
  }

  const targetDirectory = path.join(targetRoot, inducks.relativeDirectory);
  const destinationPath = path.join(targetDirectory, path.basename(archivePath));
  fs.mkdirSync(targetDirectory, { recursive: true });

  if (fs.existsSync(destinationPath)) {
    const existingHash = await hashFile(destinationPath);
    if (existingHash === archiveHash) {
      return { archivePath: destinationPath, stored: true, duplicate: true };
    }
    return { archivePath, stored: false, reason: `Different archive already exists at ${destinationPath}` };
  }

  const temporaryPath = `${destinationPath}.${process.pid}.tmp`;
  try {
    fs.copyFileSync(archivePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    if (await hashFile(temporaryPath) !== archiveHash) {
      throw new Error('Archive verification failed after copy');
    }
    fs.renameSync(temporaryPath, destinationPath);
    return { archivePath: destinationPath, stored: true, duplicate: false };
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}