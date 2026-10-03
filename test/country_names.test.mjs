/**
 * Garde-fou : les tables de pays doivent rester identiques en JS et en Python.
 *
 * Bug d'origine : COUNTRY_NAMES (JS) ne listait que 18 pays, sans 'ca'. Le repli
 * `countryCode.toUpperCase()` produisait alors « CA » au lieu de « Canada », ce
 * qui créait un second dossier pays et empechait de reconnaitre les tomes deja
 * archives (donc retelecharges pour rien).
 *
 * Ce test compare les deux tables et echoue des qu'un code disparait d'un
 * cote ou de l'autre. Il n'a besoin d'aucune dependance : node --test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const JS_TABLES = [
  'src/core/inducks/inducks.mjs',
  'download-files/src/inducks.mjs',
];

const PYTHON_MAP = 'download-files/telegram_to_drive_pipeline.py';

/** Codes ISO qu'Inducks utilise et qui doivent tous avoir un dossier nomme. */
const EXPECTED_COUNTRY_DIRS = {
  be: 'Belgium',
  bg: 'Bulgaria',
  br: 'Brazil',
  ca: 'Canada',
  ch: 'Switzerland',
  cl: 'Chile',
  co: 'Colombia',
  de: 'Germany',
  dk: 'Denmark',
  es: 'Spain',
  fi: 'Finland',
  fr: 'France',
  gr: 'Greece',
  id: 'Indonesia',
  it: 'Italy',
  mk: 'North Macedonia',
  nl: 'Netherlands',
  no: 'Norway',
  pl: 'Poland',
  pt: 'Portugal',
  se: 'Sweden',
  tr: 'Turkey',
  uk: 'United Kingdom',
  us: 'United States',
  vn: 'Vietnam',
  yu: 'Yugoslavia',
};

function readJsTable(relativePath) {
  const source = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  const start = source.indexOf('COUNTRY_NAMES');
  assert.notEqual(start, -1, `${relativePath} : COUNTRY_NAMES introuvable`);
  const block = source.slice(start, source.indexOf('};', start));
  const entries = [...block.matchAll(/'([a-z]{2,3})'\s*:\s*'([^']+)'\s*,?/g)];
  // Une virgule manquante rend tout le fichier invalide au chargement, et le
  // catalogue tombe silencieusement sur 40 titres : on veut l'echec bruyant.
  assert.match(
    source,
    /'uk'\s*:\s*'United Kingdom'\s*,\s*\n/,
    `${relativePath} : virgule manquante dans COUNTRY_NAMES (le module ne se charge plus)`
  );
  return Object.fromEntries(entries.map(([, code, name]) => [code, name]));
}

function readPythonTable() {
  const source = fs.readFileSync(path.join(rootDir, PYTHON_MAP), 'utf8');
  const start = source.indexOf('DEFAULT_COUNTRY_MAP');
  assert.notEqual(start, -1, `${PYTHON_MAP} : DEFAULT_COUNTRY_MAP introuvable`);
  const block = source.slice(start, start + 2000);
  const entries = [...block.matchAll(/"([a-z]{2,3})"\s*:\s*"([^"]+)"/g)];
  return Object.fromEntries(entries.map(([, code, name]) => [code, name]));
}

for (const relativePath of JS_TABLES) {
  test(`${relativePath} couvre tous les pays attendus`, () => {
    const table = readJsTable(relativePath);
    const missing = Object.keys(EXPECTED_COUNTRY_DIRS).filter((code) => !(code in table));
    assert.deepEqual(
      missing,
      [],
      `pays manquants dans ${relativePath} : leur dossier porterait le code en majuscules (CA au lieu de Canada)`
    );
  });

  test(`${relativePath} ne produit aucun nom de dossier majuscule`, () => {
    const table = readJsTable(relativePath);
    for (const [code, name] of Object.entries(EXPECTED_COUNTRY_DIRS)) {
      assert.notEqual(name, code.toUpperCase(), `« ${code} » ne doit pas retomber sur son code`);
    }
  });
}

test('les tables JS et Python restent synchronisées', () => {
  const pythonTable = readPythonTable();
  for (const relativePath of JS_TABLES) {
    const jsTable = readJsTable(relativePath);

    const jsOnly = Object.keys(jsTable).filter((code) => !(code in pythonTable));
    const pyOnly = Object.keys(pythonTable).filter((code) => !(code in jsTable));
    assert.deepEqual(jsOnly, [], `${relativePath} contient des pays absents de DEFAULT_COUNTRY_MAP`);
    assert.deepEqual(
      pyOnly,
      [],
      `${relativePath} n'a pas ${pyOnly.join(', ')} alors que Python les exige : le repli toUpperCase() s'appliquera`
    );

    for (const [code, name] of Object.entries(jsTable)) {
      assert.equal(
        pythonTable[code],
        name,
        `${relativePath} et Python divergent sur « ${code} » : ${name} vs ${pythonTable[code]}`
      );
    }
  }
});

test('Canada se résout en Canada, jamais en CA', () => {
  // Régression explicite : le bug observé en production.
  const table = readJsTable(JS_TABLES[0]);
  assert.equal(table.ca, 'Canada');
});