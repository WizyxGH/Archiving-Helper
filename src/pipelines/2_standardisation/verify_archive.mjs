import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import AdmZip from 'adm-zip';

function findRarExecutable() {
  const inPath = spawnSync('where', ['Rar.exe'], { encoding: 'utf8', shell: true });
  if (inPath.status === 0 && inPath.stdout.trim()) return inPath.stdout.trim().split(/\r?\n/)[0];

  for (const candidate of [
    'C:\\Program Files\\WinRAR\\Rar.exe',
    'C:\\Program Files (x86)\\WinRAR\\Rar.exe',
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function verifyArchive(archivePath) {
  const extension = path.extname(archivePath).toLowerCase();
  if (['.cbz', '.zip'].includes(extension)) {
    const entries = new AdmZip(archivePath).getEntries();
    const imageCount = entries.filter((entry) => !entry.isDirectory && /\.(jpe?g|png|webp)$/i.test(entry.entryName)).length;
    if (imageCount === 0) throw new Error(`Aucune image trouvée dans ${archivePath}`);
    return { format: extension.slice(1), imageCount, verified: true };
  }

  if (['.cbr', '.rar'].includes(extension)) {
    const rarExecutable = findRarExecutable();
    if (!rarExecutable) throw new Error('WinRAR (Rar.exe) est requis pour vérifier les CBR.');

    const test = spawnSync(rarExecutable, ['t', archivePath], { encoding: 'utf8', stdio: 'ignore' });
    if (test.error || test.status !== 0) {
      throw new Error(`Archive CBR invalide : ${(test.stderr || test.stdout || test.error?.message || `code ${test.status}`).trim()}`);
    }

    const listing = spawnSync(rarExecutable, ['lb', archivePath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    if (listing.error || listing.status !== 0) {
      throw new Error(`Impossible de lire le contenu CBR : ${(listing.stderr || listing.stdout || listing.error?.message || `code ${listing.status}`).trim()}`);
    }
    const imageCount = listing.stdout.split(/\r?\n/).filter((entry) => /\.(jpe?g|png|webp)$/i.test(entry.trim())).length;
    if (imageCount === 0) throw new Error(`Aucune image trouvée dans ${archivePath}`);
    return { format: extension.slice(1), imageCount, verified: true };
  }

  return { format: extension.slice(1), imageCount: null, verified: false };
}