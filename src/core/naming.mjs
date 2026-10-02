/**
 * Nommage des dossiers de publication.
 *
 * Le script range chaque tome sous `Pays / Titre de la publication`. Le titre
 * vient d'Inducks, dont les données contiennent des caractères interdits sous
 * Windows (`\ / : * ? " < > |`) : 422 titres sur 7 303. Sans normalisation,
 * 6 % des publications ne pourraient pas être créées.
 *
 * Règle appliquée : le caractère interdit est remplacé par un tiret, les
 * espaces inutiles sont supprimés, les points de fin reservedWindows sont
 * coupés. Le titre reste lisible et reste traçable via le code Inducks.
 */
import path from 'node:path';

/** Caractères interdits dans un nom de fichier Windows. */
const FORBIDDEN_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

/** Caractères réservés en fin de nom, même sans caractère interdit. */
const TRAILING_DOTS_SPACES = /[.\s]+$/;

/** Noms réservés par Windows, refusés même avec extension. */
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

/**
 * Rend un titre Inducks utilisable comme nom de dossier sous Windows.
 *
 * @param {string} title  titre de la publication, tel que fourni par Inducks
 * @returns {string} nom de dossier sûr, jamais vide
 */
export function sanitizeFolderName(title) {
  let name = String(title ?? '');

  // Les caractères de contrôle (dont \n, \r, \t) sont inclus dans la classe.
  name = name.replace(FORBIDDEN_CHARS, '-');
  name = name.replace(/\s{2,}/g, ' ');
  name = name.replace(TRAILING_DOTS_SPACES, '');
  name = name.trim();

  // Un remplacement en début ou fin de titre laisse un tiret isolé, collé au
  // mot voisin (« Coleção "Os Grandes Duelos" » → « Coleção -Os Grands Duelos- »).
  name = name.replace(/^-+|-+$/g, '').trim();

  if (!name) return 'Sans titre';
  if (RESERVED_NAMES.has(name.toUpperCase())) return `_${name}`;
  return name;
}

/**
 * Clé de publication Inducks à partir d'un nom de fichier canonique.
 *
 * @param {string} canonicalName  ex. `ca_BDD_10.cbr`
 * @returns {{country: string, code: string, key: string} | null}
 */
export function parsePublicationKey(canonicalName) {
  const match = String(canonicalName).match(/^([a-z]{2,3})_([A-Za-z0-9]+)_/i);
  if (!match) return null;

  const country = match[1].toLowerCase();
  const code = match[2].toUpperCase();
  return { country, code, key: `${country}_${code}` };
}

/**
 * Construit le chemin de destination d'un tome.
 *
 * @param {object} options
 * @param {string} options.rootDir      racine de la bibliothèque
 * @param {string} options.countryName  nom complet du pays, ex. `Canada`
 * @param {string} options.publicationTitle titre Inducks, ex. `BD Disney`
 * @returns {string} chemin `rootDir / Pays / Titre normalisé`
 */
export function buildDestinationPath({ rootDir, countryName, publicationTitle }) {
  const country = sanitizeFolderName(countryName || 'Inconnu');
  const publication = sanitizeFolderName(publicationTitle);
  return path.join(rootDir, country, publication);
}