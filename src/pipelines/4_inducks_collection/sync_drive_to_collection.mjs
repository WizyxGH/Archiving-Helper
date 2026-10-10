#!/usr/bin/env node
/**
 * Synchronise l'ensemble des tomes physiques présents sur le disque dur D:
 * avec le registre numérique Inducks (inducks_collection.csv / .json).
 *
 * - Détecte les tomes déjà classés avec un nom Inducks canonique (ex: br_AD_1.cbr).
 * - Préserve strictement les commentaires et notes privés déjà saisis dans le CSV.
 * - Ne touche à rien sur Git (fichiers CSV / JSON strictement ignorés).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { colorize } from '../../core/terminal.mjs';
import { targetArchivePath, collectionDirectory } from '../../core/config.mjs';
import { resolveScanStem } from '../../core/inducks/issue_index.mjs';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), '../..');

const SUPPORTED_EXTS = new Set(['.cbr', '.cbz', '.pdf', '.rar', '.zip']);

const COLUMNS = [
  'canonical_stem',
  'inducks_issue_code',
  'country',
  'publication',
  'issue_number',
  'format',
  'archive_path',
  'archive_size_bytes',
  'image_count',
  'sha256',
  'status',
  'comment',
  'updated_at',
];

function csvField(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export async function syncDriveToInducksCollection(options = {}) {
  const driveRoot = options.targetRoot || targetArchivePath();
  const collDir = options.collectionDir || collectionDirectory();

  fs.mkdirSync(collDir, { recursive: true });
  const registryPath = path.join(collDir, '.inducks_collection.json');
  const csvPath = path.join(collDir, 'inducks_collection.csv');

  console.log('='.repeat(75));
  console.log('  🔄 SYNCHRONISATION DISQUE DUR -> REGISTRE INDUCKS');
  console.log('='.repeat(75));
  console.log(`  Source Disque : ${driveRoot}`);
  console.log(`  Fichier CSV   : ${csvPath}\n`);

  let registry = {};
  if (fs.existsSync(registryPath)) {
    try {
      registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    } catch {
      registry = {};
    }
  }

  // 1. Scanner tous les fichiers BD sur le disque
  console.log('[*] Scan des fichiers sur le disque dur...');
  const diskFiles = [];
  function scan(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTS.has(ext)) {
          diskFiles.push({ full, name: entry.name, ext });
        }
      }
    }
  }
  scan(driveRoot);
  console.log(`    -> ${diskFiles.length} tomes trouvés sur le disque dur.`);

  let added = 0;
  let alreadyPresent = 0;

  // 2. Parcourir et synchroniser
  for (const file of diskFiles) {
    const format = file.ext.slice(1).toLowerCase();
    const stem = path.parse(file.name).name;
    const collectionKey = `${stem}|${format}`;

    // Si déjà présent, on s'assure juste que le chemin est exact
    if (registry[collectionKey]) {
      alreadyPresent++;
      if (registry[collectionKey].archive_path !== file.full) {
        registry[collectionKey].archive_path = file.full;
      }
      continue;
    }

    // Résolution instantanée via l'index en mémoire (ISV local)
    let inducks = null;
    try {
      inducks = resolveScanStem(stem);
    } catch {
      // résolution minimale si hors-ligne
    }

    let stat = null;
    try {
      stat = fs.statSync(file.full);
    } catch {
      continue;
    }

    const canonicalStem = inducks?.canonicalStem || stem;
    const issueCode = inducks?.issueCode || '';
    const countryCode = inducks?.countryCode || (canonicalStem.includes('_') ? canonicalStem.split('_')[0].toLowerCase() : '');
    const pubCode = inducks?.pubCode || (canonicalStem.includes('_') ? canonicalStem.split('_')[1] : '');
    const issueNum = inducks?.issueNumber || '';

    registry[collectionKey] = {
      collection_key: collectionKey,
      canonical_stem: canonicalStem,
      inducks_issue_code: issueCode,
      country: countryCode,
      publication: pubCode,
      issue_number: issueNum,
      format,
      archive_path: file.full,
      archive_size_bytes: stat.size,
      sha256: registry[collectionKey]?.sha256 || '',
      image_count: registry[collectionKey]?.image_count || '',
      inducks_entry_order: '',
      status: inducks ? 'registered' : 'needs_review',
      comment: registry[collectionKey]?.comment || registry[collectionKey]?.notes || registry[collectionKey]?.private_comments || '',
      updated_at: new Date().toISOString(),
    };

    added++;
    if (added % 100 === 0) {
      process.stdout.write(`\r[*] Synchronisation : ${added} nouveaux tomes enregistrés...`);
    }
  }

  // 3. Enregistrer les fichiers
  const records = Object.values(registry).sort((a, b) =>
    String(a.canonical_stem).localeCompare(String(b.canonical_stem), 'en', { numeric: true }) ||
    String(a.format).localeCompare(String(b.format))
  );

  const csvLines = [COLUMNS.map(csvField).join(',')];
  for (const r of records) {
    csvLines.push(COLUMNS.map((col) => csvField(r[col])).join(','));
  }

  const tmpReg = `${registryPath}.${process.pid}.tmp`;
  const tmpCsv = `${csvPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpReg, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  fs.writeFileSync(tmpCsv, `${csvLines.join('\r\n')}\r\n`, 'utf8');
  fs.renameSync(tmpReg, registryPath);
  fs.renameSync(tmpCsv, csvPath);

  console.log(`\n\n[✓] Synchronisation terminée avec succès !`);
  console.log(`    Total tomes sur le disque : ${diskFiles.length}`);
  console.log(`    Tomes déjà enregistrés    : ${alreadyPresent}`);
  console.log(`    Nouveaux tomes ajoutés    : ${colorize(String(added), 'green')}`);
  console.log(`    Total dans la collection  : ${records.length}`);
  console.log(`    Fichier : ${csvPath}\n`);

  return { total: records.length, added, alreadyPresent };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncDriveToInducksCollection().catch((err) => {
    console.error('[!] Erreur:', err);
    process.exit(1);
  });
}
