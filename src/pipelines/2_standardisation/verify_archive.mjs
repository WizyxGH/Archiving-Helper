import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import { findRarExecutable } from '../../core/config.mjs';

const IMAGE_PATTERN = /\.(jpe?g|png|webp)$/i;

/** Format réel d'après les premiers octets : 'zip', 'rar' ou null. */
function detectArchiveFormat(archivePath) {
  const head = Buffer.alloc(4);
  const descriptor = fs.openSync(archivePath, 'r');
  try {
    fs.readSync(descriptor, head, 0, 4, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  if (head.equals(Buffer.from('PK\u0003\u0004', 'latin1'))) return 'zip';
  if (head.equals(Buffer.from('Rar!', 'latin1'))) return 'rar';
  return null;
}

export function verifyArchive(archivePath) {
  const extension = path.extname(archivePath).toLowerCase();
  const expected = ['.cbz', '.zip'].includes(extension) ? 'zip'
    : ['.cbr', '.rar'].includes(extension) ? 'rar'
      : null;
  if (!expected) return { format: extension.slice(1), imageCount: null, verified: false };

  // L'extension ne suffit pas : Telegram fournit des ZIP nommés .cbr. Rar.exe
  // répondait alors « code 10 » sans plus de détail, et le tome finissait en
  // erreur de sécurité incompréhensible.
  const actual = detectArchiveFormat(archivePath);
  if (actual !== expected) {
    throw new Error(
      `Extension ${extension} mais contenu ${actual ? actual.toUpperCase() : 'inconnu'} : ${archivePath}`
    );
  }

  if (actual === 'zip') {
    const entries = new AdmZip(archivePath).getEntries();
    const imageCount = entries.filter((entry) => !entry.isDirectory && IMAGE_PATTERN.test(entry.entryName)).length;
    if (imageCount === 0) throw new Error(`Aucune image trouvée dans ${archivePath}`);
    return { format: extension.slice(1), imageCount, verified: true };
  }

  const rarExecutable = findRarExecutable();
  if (!rarExecutable) throw new Error('WinRAR (Rar.exe) est requis pour vérifier les CBR.');

  // Les deux flux sont capturés et le chemin est repris dans le message : « code 10 »
  // seul ne distingue pas une archive tronquée d'un fichier absent.
  const test = spawnSync(rarExecutable, ['t', archivePath], { encoding: 'utf8' });
  if (test.error || test.status !== 0) {
    const detail = (test.stderr || test.stdout || test.error?.message || '').trim();
    throw new Error(`Archive CBR invalide (Rar.exe code ${test.status}) : ${detail || 'aucun message'} — ${archivePath}`);
  }

  const listing = spawnSync(rarExecutable, ['lb', archivePath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (listing.error || listing.status !== 0) {
    throw new Error(`Impossible de lire le contenu CBR : ${(listing.stderr || listing.stdout || listing.error?.message || `code ${listing.status}`).trim()}`);
  }
  const imageCount = listing.stdout.split(/\r?\n/).filter((entry) => IMAGE_PATTERN.test(entry.trim())).length;
  if (imageCount === 0) throw new Error(`Aucune image trouvée dans ${archivePath}`);
  return { format: extension.slice(1), imageCount, verified: true };
}
