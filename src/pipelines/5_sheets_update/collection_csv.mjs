import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');

const COLUMNS = [
  'canonical_stem',
  'inducks_issue_code',
  'publication',
  'issue_number',
  'format',
  'archive_path',
  'archive_size_bytes',
  'sha256',
  'image_count',
  'inducks_entry_order',
  'upload_bundle',
  'status',
  'updated_at',
];

export function getCollectionDirectory() {
  return path.resolve(
    process.env.INDUCKS_COLLECTION_DIR || path.join(rootDir, 'download-files', 'files_downloads')
  );
}

function csvField(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function serializeCollectionCsv(records) {
  const lines = [COLUMNS.map(csvField).join(',')];
  for (const record of records) {
    lines.push(COLUMNS.map((column) => csvField(record[column])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function updateCollectionCsv(record, collectionDirectory = getCollectionDirectory()) {
  fs.mkdirSync(collectionDirectory, { recursive: true });
  const registryPath = path.join(collectionDirectory, '.inducks_collection.json');
  const csvPath = path.join(collectionDirectory, 'inducks_collection.csv');

  let registry = {};
  if (fs.existsSync(registryPath)) {
    registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    if (!registry || Array.isArray(registry) || typeof registry !== 'object') {
      throw new Error(`Invalid collection registry: ${registryPath}`);
    }
  }

  registry[record.collection_key] = record;
  const records = Object.values(registry).sort((left, right) =>
    String(left.canonical_stem).localeCompare(String(right.canonical_stem), 'en', { numeric: true }) ||
    String(left.format).localeCompare(String(right.format))
  );

  const temporaryRegistry = `${registryPath}.${process.pid}.tmp`;
  const temporaryCsv = `${csvPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryRegistry, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  fs.writeFileSync(temporaryCsv, serializeCollectionCsv(records), 'utf8');
  fs.renameSync(temporaryRegistry, registryPath);
  fs.renameSync(temporaryCsv, csvPath);
  return csvPath;
}