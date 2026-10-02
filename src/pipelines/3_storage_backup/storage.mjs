import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const DEFAULT_TARGET_ROOT = String.raw`D:\Duckburg Archives\Disney comics`;

function getTargetRoot() {
  if (process.env.TARGET_ARCHIVE_PATH) return path.resolve(process.env.TARGET_ARCHIVE_PATH);

  const envFile = path.join(rootDir, 'download-files', '.env');
  if (fs.existsSync(envFile)) {
    const setting = fs.readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('TARGET_ARCHIVE_PATH='));
    if (setting) return path.resolve(setting.slice(setting.indexOf('=') + 1).trim());
  }

  return path.resolve(DEFAULT_TARGET_ROOT);
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