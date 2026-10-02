import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import { findRarExecutable } from '../../core/config.mjs';

function findImages(directory) {
  const images = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) images.push(...findImages(fullPath));
    else if (/\.(jpe?g|png|webp)$/i.test(entry.name)) images.push(fullPath);
  }
  return images.sort((left, right) =>
    path.basename(left).localeCompare(path.basename(right), 'en', { numeric: true })
  );
}

export function prepareInducksUpload(archivePath, inducks, archiveHash, collectionDirectory) {
  if (!inducks?.isCertified || !inducks.issueCode || !inducks.issueEntries?.length) return null;

  const uploadRoot = path.join(collectionDirectory, 'inducks_upload_pending');
  const stem = inducks.canonicalStem.replace(/[^a-zA-Z0-9_-]/g, '_');
  const bundleName = `${stem}-${archiveHash.slice(0, 12)}`;
  const bundlePath = path.join(uploadRoot, bundleName);
  const manifestPath = path.join(bundlePath, 'inducks_upload_manifest.json');

  if (fs.existsSync(manifestPath)) {
    const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (existing.archive_sha256 === archiveHash) {
      return { path: bundlePath, imageCount: existing.image_count, reused: true };
    }
  }
  if (fs.existsSync(bundlePath)) {
    throw new Error(`Upload bundle already exists without a matching manifest: ${bundlePath}`);
  }

  fs.mkdirSync(uploadRoot, { recursive: true });
  const archiveSize = fs.statSync(archivePath).size;
  const filesystem = fs.statfsSync(uploadRoot);
  const availableBytes = Number(filesystem.bavail ?? filesystem.bfree) * Number(filesystem.bsize);
  if (availableBytes < archiveSize * 1.05) {
    throw new Error(`Espace disque insuffisant pour préparer les scans (${Math.floor(availableBytes / (1024 * 1024))} Mo libres).`);
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(uploadRoot, `.tmp-${stem}-`));

  try {
    if (/\.(cbz|zip)$/i.test(archivePath)) {
      new AdmZip(archivePath).extractAllTo(temporaryDirectory, true);
    } else if (/\.(cbr|rar)$/i.test(archivePath)) {
      const rarExecutable = findRarExecutable();
      if (!rarExecutable) throw new Error('WinRAR (Rar.exe) is required to prepare CBR uploads.');
      const result = spawnSync(
        rarExecutable,
        ['x', '-idq', '-y', archivePath, `${temporaryDirectory}${path.sep}`],
        { encoding: 'utf8' },
      );
      if (result.error || result.status !== 0) {
        throw new Error(`WinRAR extraction failed: ${(result.stderr || result.stdout || result.error?.message || `code ${result.status}`).trim()}`);
      }
    } else {
      throw new Error(`Unsupported archive format: ${path.extname(archivePath)}`);
    }

    const images = findImages(temporaryDirectory);
    if (images.length === 0) throw new Error(`No uploadable images found in ${archivePath}`);

    const manifest = {
      issue_code: inducks.issueCode,
      canonical_stem: inducks.canonicalStem,
      publication: inducks.matchedPublication.title,
      issue_number: inducks.issueNumber,
      issue_page_count: inducks.issuePageCount,
      archive_path: path.resolve(archivePath),
      archive_sha256: archiveHash,
      image_count: images.length,
      image_files: images.map((image) => path.relative(temporaryDirectory, image)),
      inducks_entry_order: inducks.issueEntries.map((entry) => entry.position),
      approval_required: true,
      upload_status: 'pending_confirmation',
      prepared_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(temporaryDirectory, 'inducks_upload_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryDirectory, bundlePath);
    return { path: bundlePath, imageCount: images.length, reused: false };
  } catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}