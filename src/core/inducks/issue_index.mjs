import fs from 'fs';
import os from 'os';
import path from 'path';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { rootDir } from '../config.mjs';

// INDUCKS_DATA_DIR gagne ; sinon on cherche les .isv dans data/inducks du
// projet, puis dans Downloads. Aucun chemin absolu en dur : un autre poste ou
// une autre arborescence se règle en une variable.
const DATA_DIR_CANDIDATES = [
  process.env.INDUCKS_DATA_DIR,
  path.join(rootDir, 'data', 'inducks'),
  path.join(os.homedir(), 'Downloads', 'inducks_extracted'),
].filter(Boolean);

let issueIndex;
const publicationEntriesCache = new Map();

function findInducksDataDir() {
  return DATA_DIR_CANDIDATES.find((directory) =>
    fs.existsSync(path.join(directory, 'inducks_issue.isv')) &&
    fs.existsSync(path.join(directory, 'inducks_entry.isv'))
  ) || null;
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

function loadIssueIndex(directory) {
  if (issueIndex) return issueIndex;

  const issueFile = path.join(directory, 'inducks_issue.isv');
  const rows = fs.readFileSync(issueFile, 'utf8').split(/\r?\n/);
  issueIndex = new Map();

  for (const row of rows.slice(1)) {
    if (!row) continue;
    const fields = row.split('^');
    const issueCode = fields[0]?.trim();
    const publicationCode = fields[2]?.trim();
    const issueNumber = normalizeIssueNumber(fields[3]);
    if (!issueCode || !publicationCode || !issueNumber) continue;

    issueIndex.set(issueCode.replace(/\s+/g, '').toLowerCase(), {
      issueCode,
      publicationCode,
      issueNumber,
      pageCount: Number.parseInt(fields[6], 10) || null,
    });
  }

  return issueIndex;
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
    if (!issueCode || !issueCode.startsWith(publicationCode)) continue;

    const issueSuffix = issueCode.slice(publicationCode.length).trim();
    if (!/^\d/.test(issueSuffix)) continue;

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

export async function resolveInducksIssue(title, issueNumber, publications, currentMatch = null) {
  const directory = findInducksDataDir();
  if (!directory) return { available: false, issue: null, publication: currentMatch, entries: [] };

  const issues = loadIssueIndex(directory);
  const candidates = publications.filter((publication) => matchesPublicationName(title, publication));
  if (currentMatch && !candidates.includes(currentMatch)) candidates.push(currentMatch);

  const matchingIssues = candidates
    .map((publication) => ({
      publication,
      issue: issues.get(`${publication.country}/${publication.code}${normalizeIssueNumber(issueNumber)}`.toLowerCase()),
    }))
    .filter((candidate) => candidate.issue);

  if (matchingIssues.length !== 1) {
    return { available: true, issue: null, publication: null, entries: [] };
  }

  const { publication, issue } = matchingIssues[0];
  const entriesByIssue = await loadEntriesForPublication(directory, issue.publicationCode);
  return {
    available: true,
    issue,
    publication,
    entries: entriesByIssue.get(issue.issueCode) || [],
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