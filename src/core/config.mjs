/**
 * Configuration centralisée.
 *
 * Tout ce qui varie d'une machine à l'autre passe par ici : chemins absolus,
 * exécutables externes, dossiers de travail. Un seul endroit à lire pour
 * savoir ce qui est configurable.
 *
 * Ordre de résolution pour chaque valeur :
 *   1. variable d'environnement du processus (prioritaire, utile en CI)
 *   2. fichier .env du projet
 *   3. valeur par défaut ci-dessous
 *
 * Le .env l'emporte sur les défauts mais perd contre process.env, ce qui permet
 * de surcharger une seule valeur sans éditer le fichier.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Racine du dépôt, calculée depuis l'emplacement de ce fichier (src/core/). */
export const rootDir = path.resolve(__dirname, '../..');

/** Fichier .env lu au démarrage, s'il existe. */
const envFilePath = path.join(rootDir, 'download-files', '.env');

function loadDotEnv() {
  if (!fs.existsSync(envFilePath)) return {};

  const values = {};
  for (const rawLine of fs.readFileSync(envFilePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    // On retire les guillemets éventuels : TARGET_ARCHIVE_PATH="D:\Mon Dossier"
    const value = line.slice(separator + 1).trim().replace(/^["'](.*)["']$/, '$1');
    if (key) values[key] = value;
  }
  return values;
}

const dotEnv = loadDotEnv();

/**
 * Première valeur définie parmi : process.env, le .env, puis les défauts.
 * Les valeurs vides sont ignorées — une variable présente mais vide
 * ("TARGET_ARCHIVE_PATH=") ne doit pas écraser un défaut utilisable.
 */
function resolve(key, fallback) {
  const candidates = [process.env[key], dotEnv[key]];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
  }
  return fallback;
}

/**
 * Valeur de configuration, figée au premier appel.
 * Les tests peuvent remplacer l'objet entier via setConfigValue().
 */
const cache = new Map();

export function config(key, fallback = undefined) {
  if (!cache.has(key)) cache.set(key, resolve(key, fallback));
  return cache.get(key);
}

/** Surcharge une valeur pour le processus courant (tests, scripts). */
export function setConfigValue(key, value) {
  cache.set(key, value);
  return value;
}

/** Vide le cache : la prochaine lecture relit process.env et le .env. */
export function resetConfigCache() {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Chemins du projet
// ---------------------------------------------------------------------------

/** Dossier des scripts et données de téléchargement (legacy mais actif). */
export const downloadFilesDir = path.join(rootDir, 'download-files');

/** Racine d'archivage sur le disque de destination (D: par défaut). */
export const targetArchivePath = () =>
  path.resolve(config('TARGET_ARCHIVE_PATH', String.raw`D:\Duckburg Archives\Disney comics`));

/**
 * Vérifie si le volume ou lecteur d'un chemin est monté et accessible.
 * Évite les plantages lorsque le disque dur externe (ex: D:) est débranché.
 */
export function isPathVolumeAccessible(targetPath) {
  try {
    const root = path.parse(path.resolve(targetPath)).root;
    return Boolean(root && fs.existsSync(root));
  } catch {
    return false;
  }
}

/** CSV de collection et paquets d'envoi Inducks (sur le poste, pas sur D:). */
export const collectionDirectory = () =>
  path.resolve(config('INDUCKS_COLLECTION_DIR', path.join(downloadFilesDir, 'files_downloads')));

/**
 * CSV d'audit et journal des runs Telegram. Le pipeline Python applique la
 * même règle : AUDIT_DIR, sinon le dossier de collection.
 */
export const auditDirectory = () => path.resolve(config('AUDIT_DIR', collectionDirectory()));

// ---------------------------------------------------------------------------
// Données Inducks
// ---------------------------------------------------------------------------

/**
 * Dossier contenant les .isv d'Inducks (issue, entry, publication).
 * Par défaut cherché dans le dossier du projet, qui les embarque.
 */
export const inducksDataDir = () => {
  const configured = config('INDUCKS_DATA_DIR');
  const candidates = [
    configured,
    path.join(rootDir, 'data', 'inducks'),
    path.join(os.homedir(), 'Downloads', 'inducks_extracted'),
  ].filter(Boolean);

  return candidates.find((directory) =>
    fs.existsSync(path.join(directory, 'inducks_issue.isv'))
  ) || candidates[0];
};

/** Fichier .isv des publications, dans le dossier de données Inducks. */
export const publicationsIsvPath = () => {
  const configured = config('INDUCKS_PUBLICATIONS_ISV');
  return configured
    ? path.resolve(configured)
    : path.join(inducksDataDir(), 'inducks_publication.isv');
};

// ---------------------------------------------------------------------------
// Exécutables externes
// ---------------------------------------------------------------------------

/**
 * Localise Rar.exe. RAR_EXECUTABLE gagne si défini, sinon le PATH,
 * sinon les emplacements d'installation standard.
 */
export function findRarExecutable() {
  const configured = config('RAR_EXECUTABLE');
  if (configured) {
    if (fs.existsSync(configured)) return configured;
    throw new Error(
      `RAR_EXECUTABLE pointe vers un fichier introuvable : ${configured}`
    );
  }

  const inPath = process.platform === 'win32'
    ? findOnPathWindows('Rar.exe')
    : findOnPathPosix('rar');
  if (inPath) return inPath;

  const standardLocations = [
    String.raw`C:\Program Files\WinRAR\Rar.exe`,
    String.raw`C:\Program Files (x86)\WinRAR\Rar.exe`,
    '/usr/bin/rar',
    '/usr/local/bin/rar',
  ];
  return standardLocations.find((candidate) => fs.existsSync(candidate)) || null;
}

function findOnPathWindows(executable) {
  const directories = (process.env.PATH || '').split(';');
  for (const directory of directories) {
    const candidate = path.join(directory, executable);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findOnPathPosix(executable) {
  const directories = (process.env.PATH || '').split(':');
  for (const directory of directories) {
    const candidate = path.join(directory, executable);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}