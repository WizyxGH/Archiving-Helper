import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveInducksIssue } from '../../src/core/inducks/issue_index.mjs';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'archiving-helper', 'inducks');
const DB_FILE = path.join(CACHE_DIR, 'inducks_publications.json');
const META_FILE = path.join(CACHE_DIR, 'inducks_sync_meta.json');

// Canonical mapping of ISO country prefixes to official Inducks country names
export const COUNTRY_NAMES = {
  'de': 'Germany',
  'fr': 'France',
  'it': 'Italy',
  'us': 'United States',
  'nl': 'Netherlands',
  'dk': 'Denmark',
  'se': 'Sweden',
  'no': 'Norway',
  'fi': 'Finland',
  'br': 'Brazil',
  'es': 'Spain',
  'be': 'Belgium',
  'gr': 'Greece',
  'pt': 'Portugal',
  'pl': 'Poland',
  'tr': 'Turkey',
  'id': 'Indonesia',
  'uk': 'United Kingdom',
  'bg': 'Bulgaria',
  'ca': 'Canada',
  'ch': 'Switzerland',
  'cl': 'Chile',
  'co': 'Colombia',
  'mk': 'North Macedonia',
  'vn': 'Vietnam',
  'yu': 'Yugoslavia',
};

// Core Inducks publications database (rich multi-country reference catalog)
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

/**
 * Normalizes text for robust fuzzy & keyword matching
 */
function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')     // alphanumeric only
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Ensures Inducks database cache is synchronized (runs once per day on first usage)
 */
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

  // Check if daily sync already ran today
  if (!force && meta.lastSyncDate === today && fs.existsSync(DB_FILE)) {
    return loadCachedDatabase();
  }

  console.log(`\n[*] Synchronisation quotidienne de la base Inducks (${today})...`);

  let db = [...BUILTIN_PUBLICATIONS];

  // If previous cached publications exist, merge them
  if (fs.existsSync(DB_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const keys = new Set(db.map(p => `${p.country}_${p.code}`));
      for (const item of existing) {
        const k = `${item.country}_${item.code}`;
        if (!keys.has(k)) {
          db.push(item);
          keys.add(k);
        }
      }
    } catch (_) {}
  }

  // Persist updated database
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  fs.writeFileSync(META_FILE, JSON.stringify({ lastSyncDate: today, totalPublications: db.length, syncedAt: new Date().toISOString() }, null, 2), 'utf8');

  console.log(`[+] Base Inducks synchronisée : ${db.length} séries indexées.\n`);
  return db;
}

/**
 * Loads cached Inducks publications
 */
export function loadCachedDatabase() {
  if (fs.existsSync(DB_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (_) {}
  }
  return BUILTIN_PUBLICATIONS;
}

/**
 * Automatically resolves any raw input (title, URL, filename) into a full Inducks canonical descriptor
 *
 * @param {string} rawInput - e.g. "Alben/UltimatePhantomias47.cbr" or "Picsou Magazine 550"
 * @param {object} [options]
 * @returns {object} Canonical Inducks metadata
 */
export async function resolveInducksPublication(rawInput, options = {}) {
  await syncInducksDatabase();
  const db = loadCachedDatabase();

  // Strip path/URL wrapper
  let cleanStr = path.basename(rawInput).replace(/\.(cbr|cbz|pdf|zip|rar|7z)$/i, '');
  if (cleanStr.includes('bookUri=')) {
    const m = cleanStr.match(/bookUri=([^&]+)/);
    if (m) cleanStr = path.basename(decodeURIComponent(decodeURIComponent(m[1])));
  }

  // Extract issue number (supports formats like 47, 047, #47, 1995-12, 12B)
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

  // Remove the issue number from the title string for series matching
  const titleWithoutNum = cleanStr.replace(new RegExp(`_?${issueNumber}\\b`, 'i'), '').trim();
  const normSearch = normalizeText(titleWithoutNum);

  // Search in Inducks database
  let bestMatch = null;
  let highestScore = 0;

  for (const pub of db) {
    const pubNorm = normalizeText(pub.title);
    const codeNorm = normalizeText(`${pub.country} ${pub.code}`);

    // Exact alias or title match
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

      // Check strict substring match (only if alias is at least 4 chars long to avoid false positives)
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

  // Strict Zero-Guesswork Check: Never invent a code or country if not found with certainty
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

  const countryCode = bestMatch.country;
  const pubCode = bestMatch.code;
  const countryFolder = COUNTRY_NAMES[countryCode] || countryCode.toUpperCase();
  const seriesFolder = bestMatch.title;

  const canonicalStem = `${countryCode}_${pubCode}_${issueNumber}`;
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
    issueCode: issueLookup.issue?.issueCode || null,
    issuePageCount: issueLookup.issue?.pageCount || null,
    issueEntries: issueLookup.entries,
    countryFolder,
    seriesFolder,
    relativeDirectory: path.join(countryFolder, seriesFolder),
    matchedPublication: bestMatch
  };
}
