import fs from 'fs';
import path from 'path';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { inducksDataDir } from '../config.mjs';

let issueIndex;
const publicationEntriesCache = new Map();

// Le dossier vient de config.mjs (variable d'environnement, puis .env, puis
// défauts). Lire process.env directement ici ignorait le .env : l'index des
// numéros n'était jamais chargé et chaque tome finissait « needs_inducks_review ».
function findInducksDataDir() {
  const directory = inducksDataDir();
  return directory &&
    fs.existsSync(path.join(directory, 'inducks_issue.isv')) &&
    fs.existsSync(path.join(directory, 'inducks_entry.isv'))
    ? directory
    : null;
}

function normalizeIssueNumber(value) {
  return String(value || '').trim().replace(/^0+(?=\d)/, '').toLowerCase();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesPublicationName(query, publication) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return false;

  const names = [publication.title, publication.code, `${publication.country} ${publication.code}`, ...(publication.aliases || [])];
  return names.some((name) => {
    const normalizedName = normalizeText(name);
    return normalizedName === normalizedQuery ||
      normalizedName.startsWith(`${normalizedQuery} `) ||
      normalizedName.endsWith(` ${normalizedQuery}`);
  });
}

/** Clé de recherche d'un numéro : code Inducks sans espaces, en minuscules. */
function issueKey(issueCode) {
  return String(issueCode).replace(/\s+/g, '').toLowerCase();
}

function loadIssueIndex(directory) {
  if (issueIndex) return issueIndex;

  const issueFile = path.join(directory, 'inducks_issue.isv');
  const rows = fs.readFileSync(issueFile, 'utf8').split(/\r?\n/);
  const byKey = new Map();
  const countries = new Set();
  const byPublication = new Map();

  for (const row of rows.slice(1)) {
    if (!row) continue;
    const fields = row.split('^');
    const issueCode = fields[0]?.trim();
    const publicationCode = fields[2]?.trim();
    const rawIssueNumber = String(fields[3] || '').trim();
    const issueNumber = normalizeIssueNumber(rawIssueNumber);
    if (!issueCode || !publicationCode || !issueNumber) continue;

    const issue = {
      issueCode,
      publicationCode,
      issueNumber,
      rawIssueNumber,
      pageCount: Number.parseInt(fields[6], 10) || null,
    };

    // Deux codes qui ne diffèrent que par les espaces donneraient la même clé.
    // Plutôt que de garder le dernier lu, on marque la clé ambiguë.
    const key = issueKey(issueCode);
    const existing = byKey.get(key);
    byKey.set(key, existing && existing.issueCode !== issueCode ? { ambiguous: true } : issue);

    countries.add(issueCode.split('/')[0].toLowerCase());
    if (!byPublication.has(publicationCode)) byPublication.set(publicationCode, new Set());
    byPublication.get(publicationCode).add(issueCode);
  }

  issueIndex = { byKey, countries, byPublication };
  return issueIndex;
}

function lookupIssue(index, key) {
  const issue = index.byKey.get(key);
  return issue && !issue.ambiguous ? issue : null;
}

function comparePositions(left, right) {
  const leftPosition = left.position.toLowerCase();
  const rightPosition = right.position.toLowerCase();
  const leftPage = leftPosition.match(/^p(\d+)$/);
  const rightPage = rightPosition.match(/^p(\d+)$/);

  if (leftPage && rightPage) return Number(leftPage[1]) - Number(rightPage[1]);
  if (leftPage) return -1;
  if (rightPage) return 1;
  if (leftPosition === 'z') return rightPosition === 'z' ? 0 : 1;
  if (rightPosition === 'z') return -1;
  return leftPosition.localeCompare(rightPosition);
}

async function loadEntriesForPublication(directory, publicationCode) {
  const cacheKey = `${directory}|${publicationCode.toLowerCase()}`;
  if (publicationEntriesCache.has(cacheKey)) return publicationEntriesCache.get(cacheKey);

  // Les numéros de la publication viennent de l'index, pas d'un préfixe de
  // texte : fr/GHL a des numéros « M  2 » (code fr/GHLM  2) qu'un filtre
  // « commence par un chiffre » écartait, et fr/PM ne doit pas capter fr/PMHS.
  const issueCodes = loadIssueIndex(directory).byPublication.get(publicationCode) || new Set();
  const entriesByIssue = new Map();
  const entryFile = path.join(directory, 'inducks_entry.isv');
  const lines = readline.createInterface({
    input: createReadStream(entryFile, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!line || line.startsWith('entrycode^')) continue;
    const fields = line.split('^');
    const issueCode = fields[1]?.trim();
    if (!issueCode || !issueCodes.has(issueCode)) continue;

    const entries = entriesByIssue.get(issueCode) || [];
    entries.push({
      position: fields[5]?.trim() || '',
      storyCode: fields[2]?.trim() || '',
      title: fields[8]?.trim() || fields[9]?.trim() || '',
    });
    entriesByIssue.set(issueCode, entries);
  }

  for (const entries of entriesByIssue.values()) entries.sort(comparePositions);
  publicationEntriesCache.set(cacheKey, entriesByIssue);
  return entriesByIssue;
}

/** Sommaire Inducks d'un numéro résolu (vide si les données manquent). */
export async function entriesForIssue(issue) {
  const directory = findInducksDataDir();
  if (!directory || !issue) return [];
  const entriesByIssue = await loadEntriesForPublication(directory, issue.publicationCode);
  return entriesByIssue.get(issue.issueCode) || [];
}

/**
 * Résout un nom de scan en numéro Inducks, sans rien deviner.
 *
 * Les scans portent le code Inducks du numéro, espaces remplacés par « _ » :
 *   fr_PMHS_S5  -> fr/PMHS S5     (pays explicite)
 *   GHL_M_2     -> fr/GHLM  2     (pays absent : publication fr/GHL, numéro « M  2 »)
 *
 * Avec un préfixe pays connu, seul ce pays est consulté. Sans préfixe, tous
 * les pays sont essayés et le résultat n'est accepté que s'il est unique.
 * Retourne null si les données Inducks manquent, si rien ne correspond ou si
 * plusieurs numéros correspondent.
 */
export function resolveScanStem(stem) {
  const directory = findInducksDataDir();
  if (!directory) return null;
  const index = loadIssueIndex(directory);

  const tokens = String(stem || '').split('_').filter(Boolean);
  if (tokens.length < 2) return null;

  let issue = null;
  const first = tokens[0].toLowerCase();
  if (index.countries.has(first)) {
    issue = lookupIssue(index, `${first}/${tokens.slice(1).join('')}`.toLowerCase());
  }

  if (!issue) {
    const code = tokens.join('').toLowerCase();
    const matches = [...index.countries]
      .map((country) => lookupIssue(index, `${country}/${code}`))
      .filter(Boolean);
    if (matches.length !== 1) return null;
    issue = matches[0];
  }

  const [countryCode, pubCode] = issue.publicationCode.split('/');
  const numberPart = issue.rawIssueNumber.split(/\s+/).join('_');
  return {
    ...issue,
    countryCode: countryCode.toLowerCase(),
    pubCode,
    issueNumber: issue.rawIssueNumber.split(/\s+/).join(' '),
    canonicalStem: `${countryCode.toLowerCase()}_${pubCode}_${numberPart}`,
  };
}

export async function resolveInducksIssue(title, issueNumber, publications, currentMatch = null) {
  const directory = findInducksDataDir();
  if (!directory) return { available: false, issue: null, publication: currentMatch, entries: [] };

  const index = loadIssueIndex(directory);
  const candidates = publications.filter((publication) => matchesPublicationName(title, publication));
  if (currentMatch && !candidates.includes(currentMatch)) candidates.push(currentMatch);

  const matchingIssues = candidates
    .map((publication) => ({
      publication,
      issue: lookupIssue(index, `${publication.country}/${publication.code}${normalizeIssueNumber(issueNumber)}`.toLowerCase()),
    }))
    .filter((candidate) => candidate.issue);

  if (matchingIssues.length !== 1) {
    return { available: true, issue: null, publication: null, entries: [] };
  }

  const { publication, issue } = matchingIssues[0];
  return {
    available: true,
    issue,
    publication,
    entries: await entriesForIssue(issue),
  };
}

export function orderPageKeysByInducks(pageKeys, entries = []) {
  const numberedEntries = entries
    .map((entry, order) => {
      const match = entry.position.match(/^p(\d+)$/i);
      return match ? { order, page: Number(match[1]) } : null;
    })
    .filter(Boolean);
  const finalEntryOrder = entries.findIndex((entry) => entry.position.toLowerCase() === 'z');
  const lastPage = Math.max(...pageKeys.map((key) => Number.parseInt(key, 10)).filter(Number.isFinite));

  if (numberedEntries.length === 0) {
    return [...pageKeys].sort((left, right) => Number(left) - Number(right));
  }

  function getEntryOrder(pageKey) {
    const page = Number.parseInt(pageKey, 10);
    if (finalEntryOrder >= 0 && page === lastPage) return finalEntryOrder;

    let order = -1;
    for (const entry of numberedEntries) {
      if (entry.page > page) break;
      order = entry.order;
    }
    return order;
  }

  return [...pageKeys].sort((left, right) => {
    const orderDifference = getEntryOrder(left) - getEntryOrder(right);
    return orderDifference || Number(left) - Number(right);
  });
}
