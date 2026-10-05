import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveInducksIssue, resolveScanStem, entriesForIssue } from './issue_index.mjs';
import { config, publicationsIsvPath } from '../config.mjs';

// Cache de la base de publications. INDUCKS_CACHE_DIR permet de le poser
// ailleurs (disque externe, RAM disk) sans toucher au code.
const CACHE_DIR = path.resolve(
  config('INDUCKS_CACHE_DIR', path.join(os.homedir(), '.cache', 'archiving-helper', 'inducks'))
);
const DB_FILE = path.join(CACHE_DIR, 'inducks_publications.json');
const META_FILE = path.join(CACHE_DIR, 'inducks_sync_meta.json');

// Codes pays Inducks -> nom de dossier. Généré par scripts/gen-country-names.py
// depuis inducks_country : ne pas réduire cette liste à la main. Un code absent
// retombe sur son code en majuscules comme nom de dossier (EG, LU) — c'est ce
// que country_names.test.mjs garde. Deux libellés diffèrent d'Inducks ('UK',
// 'USA') volontairement.
export const COUNTRY_NAMES = {
  'ae': 'United Arab Emirates',
  'al': 'Albania',
  'an': 'Netherlands Antilles',
  'ar': 'Argentina',
  'at': 'Austria',
  'au': 'Australia',
  'bb': 'Barbados',
  'be': 'Belgium',
  'bg': 'Bulgaria',
  'br': 'Brazil',
  'by': 'Belarus',
  'ca': 'Canada',
  'ch': 'Switzerland',
  'cl': 'Chile',
  'cn': 'China',
  'co': 'Colombia',
  'cu': 'Cuba',
  'cz': 'Czech Republic',
  'dc': 'Digital comics',
  'de': 'Germany',
  'dk': 'Denmark',
  'dz': 'Algeria',
  'ec': 'Ecuador',
  'ee': 'Estonia',
  'eg': 'Egypt',
  'es': 'Spain',
  'fi': 'Finland',
  'fo': 'Faroe Islands',
  'fr': 'France',
  'gr': 'Greece',
  'gt': 'Guatemala',
  'gy': 'Guyana',
  'hk': 'Hong Kong',
  'hn': 'Honduras',
  'hr': 'Croatia',
  'hu': 'Hungary',
  'id': 'Indonesia',
  'ie': 'Ireland',
  'il': 'Israel',
  'in': 'India',
  'ir': 'Iran',
  'is': 'Iceland',
  'it': 'Italy',
  'jp': 'Japan',
  'kr': 'South Korea',
  'kw': 'Kuwait',
  'lb': 'Lebanon',
  'lt': 'Lithuania',
  'lu': 'Luxembourg',
  'lv': 'Latvia',
  'ma': 'Morocco',
  'mk': 'North Macedonia',
  'mn': 'Mongolia',
  'mx': 'Mexico',
  'my': 'Malaysia',
  'nl': 'Netherlands',
  'no': 'Norway',
  'nz': 'New Zealand',
  'pa': 'Panama',
  'pe': 'Peru',
  'ph': 'Philippines',
  'pl': 'Poland',
  'pt': 'Portugal',
  'ro': 'Romania',
  'rs': 'Serbia',
  'ru': 'Russia',
  'sa': 'Saudi Arabia',
  'se': 'Sweden',
  'sg': 'Singapore',
  'si': 'Slovenia',
  'sk': 'Slovakia',
  'sv': 'El Salvador',
  'th': 'Thailand',
  'tn': 'Tunisia',
  'tr': 'Turkey',
  'tw': 'Taiwan',
  'ua': 'Ukraine',
  'uk': 'United Kingdom',
  'us': 'United States',
  'uy': 'Uruguay',
  've': 'Venezuela',
  'vn': 'Vietnam',
  'yu': 'Yugoslavia',
  'za': 'South Africa',
};

const BUILTIN_PUBLICATIONS = [
  // Germany (de)
  { country: 'de', code: 'LTBUP', title: 'Lustiges Taschenbuch Ultimate Phantomias', aliases: ['Ultimate Phantomias', 'UltimatePhantomias', 'LTB Ultimate Phantomias', 'LTBUP'] },
  { country: 'de', code: 'LTB', title: 'Lustiges Taschenbuch', aliases: ['Lustiges Taschenbuch', 'LTB', 'Walt Disneys Lustiges Taschenbuch'] },
  { country: 'de', code: 'LTBEE', title: 'LTB Enten-Edition', aliases: ['LTB Enten-Edition', 'Enten Edition', 'LTBEE'] },
  { country: 'de', code: 'LTBSP', title: 'LTB Spezial', aliases: ['LTB Spezial', 'LTBSP'] },
  { country: 'de', code: 'LTBPR', title: 'LTB Premium', aliases: ['LTB Premium', 'LTBPR'] },
  { country: 'de', code: 'LTBEX', title: 'LTB Extra', aliases: ['LTB Extra', 'LTBEX'] },
  { country: 'de', code: 'MM', title: 'Micky Maus', aliases: ['Micky Maus Magazin', 'Micky Maus', 'MM'] },
  { country: 'de', code: 'TGDD', title: 'Die tollsten Geschichten von Donald Duck', aliases: ['Die tollsten Geschichten von Donald Duck', 'TGDD', 'DDSH'] },
  { country: 'de', code: 'DDT', title: 'Donald Duck Taschenbuch', aliases: ['Donald Duck Taschenbuch', 'DDT'] },
  { country: 'de', code: 'ODT', title: 'Onkel Dagobert Taschenbuch', aliases: ['Onkel Dagobert Taschenbuch', 'ODT'] },

  // France (fr)
  { country: 'fr', code: 'PM', title: 'Picsou Magazine', aliases: ['Picsou Magazine', 'Picsou Mag', 'PM'] },
  { country: 'fr', code: 'JM', title: 'Le Journal de Mickey', aliases: ['Le Journal de Mickey', 'Journal de Mickey', 'JDM', 'JM'] },
  { country: 'fr', code: 'MP', title: 'Mickey Parade Géant', aliases: ['Mickey Parade Geant', 'Mickey Parade', 'MPG', 'MP'] },
  { country: 'fr', code: 'SPG', title: 'Super Picsou Géant', aliases: ['Super Picsou Geant', 'Super Picsou', 'SPG'] },
  { country: 'fr', code: 'DDD', title: 'La dynastie Donald Duck', aliases: ['La dynastie Donald Duck', 'Dynastie Donald Duck', 'DDD'] },
  { country: 'fr', code: 'GDM', title: 'La grande dynastie des Mickey', aliases: ['La grande dynastie des Mickey', 'GDM'] },
  { country: 'fr', code: 'TDD', title: 'Les trésors de Donald Duck', aliases: ['Les tresors de Donald Duck', 'Tresors de Donald', 'TDD'] },
  { country: 'fr', code: 'TPI', title: 'Les trésors de Picsou', aliases: ['Les tresors de Picsou', 'Tresors de Picsou', 'TPI'] },
  { country: 'fr', code: 'HSJM', title: 'Hors-série Le Journal de Mickey', aliases: ['Hors-serie Journal de Mickey', 'HSJM'] },
  { country: 'fr', code: 'HSPM', title: 'Hors-série Picsou Magazine', aliases: ['Hors-serie Picsou Magazine', 'HSPM'] },

  // Italy (it)
  { country: 'it', code: 'TL', title: 'Topolino', aliases: ['Topolino', 'Topolino Libretto', 'TL'] },
  { country: 'it', code: 'PKNA', title: 'PKNA - Paperinik New Adventures', aliases: ['Paperinik New Adventures', 'PKNA', 'PK'] },
  { country: 'it', code: 'PK2', title: 'PK2', aliases: ['PK2', 'Paperinik PK2'] },
  { country: 'it', code: 'PK3', title: 'PK - Pikappa', aliases: ['PK Pikappa', 'Pikappa', 'PK3'] },
  { country: 'it', code: 'PAP', title: 'Paperino', aliases: ['Paperino Mese', 'Paperino', 'PAP'] },
  { country: 'it', code: 'CPA', title: 'I Grandi Classici Disney', aliases: ['I Grandi Classici Disney', 'Grandi Classici', 'GCD', 'CPA'] },
  { country: 'it', code: 'ZM', title: 'Zio Paperone', aliases: ['Zio Paperone', 'ZP', 'ZM'] },
  { country: 'it', code: 'WID', title: 'W.I.T.C.H.', aliases: ['W.I.T.C.H.', 'WITCH', 'WID'] },

  // United States (us)
  { country: 'us', code: 'WDC', title: 'Walt Disney\'s Comics and Stories', aliases: ['Walt Disney\'s Comics and Stories', 'WDC', 'WDC&S'] },
  { country: 'us', code: 'US', title: 'Uncle Scrooge', aliases: ['Uncle Scrooge', 'US'] },
  { country: 'us', code: 'DD', title: 'Donald Duck', aliases: ['Donald Duck', 'DD'] },
  { country: 'us', code: 'MM', title: 'Mickey Mouse', aliases: ['Mickey Mouse', 'MM'] },
  { country: 'us', code: 'CBCO', title: 'Carl Barks Comic Album', aliases: ['Carl Barks Comic Album', 'Carl Barks Library', 'CBCO'] },
  { country: 'us', code: 'DRCO', title: 'Don Rosa Library', aliases: ['Don Rosa Library', 'The Don Rosa Classics', 'DRCO'] },

  // Netherlands (nl)
  { country: 'nl', code: 'DD', title: 'Donald Duck Weekblad', aliases: ['Donald Duck Weekblad', 'Donald Duck', 'DD'] },
  { country: 'nl', code: 'DDE', title: 'Donald Duck Extra', aliases: ['Donald Duck Extra', 'DDE'] },
  { country: 'nl', code: 'DDP', title: 'Donald Duck Pocket', aliases: ['Donald Duck Pocket', 'DDP'] },

  // Brazil (br)
  { country: 'br', code: 'PD', title: 'Pato Donald', aliases: ['Pato Donald', 'PD'] },
  { country: 'br', code: 'TP', title: 'Tio Patinhas', aliases: ['Tio Patinhas', 'TP'] },
  { country: 'br', code: 'ZE', title: 'Zé Carioca', aliases: ['Ze Carioca', 'ZE'] }
];

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findLocalInducksSource() {
  // INDUCKS_PUBLICATIONS_ISV gagne ; sinon on cherche l'archive téléchargée
  // puis le dossier de données. Les chemins absolus d'un autre projet
  // disparaissent au profit de l'option de configuration.
  const configured = config('INDUCKS_PUBLICATIONS_ISV');
  const possiblePaths = [
    ...(configured ? [path.resolve(configured)] : []),
    path.join(os.homedir(), 'Downloads', 'isv.tgz'),
    path.join(os.homedir(), 'Downloads', 'inducks_publication.isv'),
    publicationsIsvPath(),
  ].filter(Boolean);

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function parseIsvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const pubs = [];

  for (const line of lines) {
    if (!line || !line.includes('^')) continue;
    const parts = line.split('^');
    const pubCode = parts[0]?.trim();
    const countryCode = parts[1]?.trim()?.toLowerCase();
    const title = parts[3]?.trim();

    if (pubCode && countryCode && title) {
      const cleanCode = pubCode.includes('/') ? pubCode.split('/')[1] : pubCode;
      pubs.push({
        country: countryCode,
        code: cleanCode,
        title: title,
        aliases: [title, cleanCode]
      });
    }
  }
  return pubs;
}

/**
 * La base Inducks fait foi ; la liste manuelle ne sert que de secours sans .isv.
 *
 * Elle passait avant la base et imposait ses titres : 29 sur 40 différaient
 * d'Inducks (« Topolino » au lieu de « Topolino (libretto) »), et certains
 * codes désignaient une autre publication (us/CBCO est « The Barks Collector »).
 * Seuls les alias d'une entrée dont le titre concorde avec Inducks sont
 * repris : les autres pourraient rattacher un nom au mauvais numéro.
 */
function mergeBuiltinAliases(isvPubs) {
  const byKey = new Map(isvPubs.map((pub) => [`${pub.country}_${pub.code}`.toLowerCase(), pub]));
  for (const builtin of BUILTIN_PUBLICATIONS) {
    const official = byKey.get(`${builtin.country}_${builtin.code}`.toLowerCase());
    if (official && normalizeText(official.title) === normalizeText(builtin.title)) {
      official.aliases = [...new Set([...official.aliases, ...builtin.aliases])];
    }
  }
  return isvPubs;
}

export async function syncInducksDatabase(force = false) {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const today = new Date().toISOString().slice(0, 10);
  let meta = { lastSyncDate: null };

  if (fs.existsSync(META_FILE)) {
    try {
      meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    } catch (_) {}
  }

  if (!force && meta.lastSyncDate === today && fs.existsSync(DB_FILE)) {
    return loadCachedDatabase();
  }

  console.log(`\n[*] Synchronisation quotidienne Inducks (${today})...`);

  let db = [...BUILTIN_PUBLICATIONS];

  const localIsv = findLocalInducksSource();
  if (localIsv) {
    try {
      console.log(`[+] Source locale Inducks détectée : ${localIsv}`);
      const isvPubs = parseIsvFile(localIsv);
      db = mergeBuiltinAliases(isvPubs);
      console.log(`[+] ${isvPubs.length} publications importées depuis le fichier ISV.`);
    } catch (e) {
      console.warn(`[!] Erreur lecture ISV : ${e.message}`);
    }
  }

  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  fs.writeFileSync(META_FILE, JSON.stringify({ lastSyncDate: today, totalPublications: db.length, syncedAt: new Date().toISOString() }, null, 2), 'utf8');

  console.log(`[+] Base Inducks prête : ${db.length} séries indexées.\n`);
  return db;
}

export function loadCachedDatabase() {
  if (fs.existsSync(DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (_) {}
  }
  return BUILTIN_PUBLICATIONS;
}

/**
 * Resolves a comic name or URL against the Inducks database.
 * Never invents a fake code or country if uncertain or not found.
 */
export async function resolveInducksPublication(rawInput, options = {}) {
  await syncInducksDatabase();
  const db = loadCachedDatabase();

  let cleanStr = path.basename(rawInput).replace(/\.(cbr|cbz|pdf|zip|rar|7z)$/i, '');
  if (cleanStr.includes('bookUri=')) {
    const m = cleanStr.match(/bookUri=([^&]+)/);
    if (m) cleanStr = path.basename(decodeURIComponent(decodeURIComponent(m[1])));
  }

  // Nom de scan au format Inducks (« fr_PMHS_S5 », « GHL_M_2 ») : le numéro
  // est cherché tel quel dans l'index, sans heuristique sur le titre. C'est le
  // seul chemin qui sait lire un numéro composé (« M  2 ») ou un pays implicite.
  if (!options.customTomeNum) {
    const scan = resolveScanStem(cleanStr);
    const publication = scan && db.find((pub) =>
      pub.country === scan.countryCode && String(pub.code).toUpperCase() === scan.pubCode.toUpperCase());
    if (publication) {
      return certifiedResult(publication, scan.issueNumber, scan, await entriesForIssue(scan), scan.canonicalStem);
    }
  }

  let issueNumber = options.customTomeNum || null;
  if (!issueNumber) {
    const numMatch = cleanStr.match(/(?:tome|vol|volume|no|#|\s|_|-)?(\d{1,4}(?:[a-zA-Z]|-\d{1,2})?)$/i) ||
                     cleanStr.match(/(\d{1,4})/);
    if (numMatch) {
      issueNumber = numMatch[1].replace(/^0+/, '') || numMatch[1];
    } else {
      issueNumber = '1';
    }
  }

  const titleWithoutNum = cleanStr.replace(new RegExp(`_?${issueNumber}\\b`, 'i'), '').trim();
  const normSearch = normalizeText(titleWithoutNum);

  let bestMatch = null;
  let highestScore = 0;

  for (const pub of db) {
    const pubNorm = normalizeText(pub.title);
    const codeNorm = normalizeText(`${pub.country} ${pub.code}`);

    if (normSearch === pubNorm || normSearch === codeNorm || normSearch === normalizeText(pub.code)) {
      bestMatch = pub;
      break;
    }

    for (const alias of (pub.aliases || [])) {
      const aliasNorm = normalizeText(alias);
      if (normSearch === aliasNorm) {
        bestMatch = pub;
        break;
      }

      if (aliasNorm.length >= 4 && (normSearch === aliasNorm || normSearch.startsWith(aliasNorm + ' ') || normSearch.endsWith(' ' + aliasNorm))) {
        const score = aliasNorm.length;
        if (score > highestScore) {
          highestScore = score;
          bestMatch = pub;
        }
      }
    }

    if (bestMatch && highestScore === 0) break;
  }

  const issueLookup = await resolveInducksIssue(titleWithoutNum, issueNumber, db, bestMatch);
  if (issueLookup.available) bestMatch = issueLookup.publication;

  // Strict Zero-Guesswork Check
  if (!bestMatch) {
    const originalCleanName = cleanStr;
    const archiveFilename = `${originalCleanName}.cbz`;
    const imagePrefix = `${originalCleanName}_`;

    return {
      isCertified: false,
      canonicalStem: null,
      archiveFilename,
      countryCode: null,
      pubCode: null,
      issueNumber,
      imagePrefix,
      countryFolder: 'Non_Classe',
      seriesFolder: originalCleanName,
      relativeDirectory: path.join('Non_Classe', originalCleanName),
      matchedPublication: null
    };
  }

  return certifiedResult(bestMatch, issueNumber, issueLookup.issue, issueLookup.entries);
}

/** Résultat certifié commun aux deux chemins de résolution. */
function certifiedResult(publication, issueNumber, issue, entries, canonicalStemOverride = null) {
  const countryCode = publication.country;
  const pubCode = publication.code;
  const countryFolder = COUNTRY_NAMES[countryCode] || countryCode.toUpperCase();
  const seriesFolder = publication.title;

  const canonicalStem = canonicalStemOverride || `${countryCode}_${pubCode}_${issueNumber}`;
  const archiveFilename = `${canonicalStem}.cbz`;
  const imagePrefix = `${canonicalStem}_`;

  return {
    isCertified: true,
    canonicalStem,
    archiveFilename,
    countryCode,
    pubCode,
    issueNumber,
    imagePrefix,
    issueCode: issue?.issueCode || null,
    issuePageCount: issue?.pageCount || null,
    issueEntries: entries || [],
    countryFolder,
    seriesFolder,
    relativeDirectory: path.join(countryFolder, seriesFolder),
    matchedPublication: publication
  };
}
