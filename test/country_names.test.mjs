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
];

// Ancienne copie du module : elle doit rester un simple renvoi. Une seconde
// table de pays finirait par diverger, comme celle qui recréait CA/EG/LU.
const LEGACY_REEXPORT = 'download-files/src/inducks.mjs';

const PYTHON_MAP = 'download-files/telegram_to_drive_pipeline.py';

/**
 * Codes ISO qu'Inducks utilise et qui doivent tous avoir un dossier nommé.
 *
 * La liste complète vient d'inducks_country (84 pays) et non d'une saisie à la
 * main : celle-ci avait dérivé à 25, ce qui faisait retomber les autres sur leur
 * code en majuscules (EG, LU). Voir scripts/gen-country-names.py.
 */
const EXPECTED_COUNTRY_DIRS = {
  ae: 'United Arab Emirates',
  al: 'Albania',
  an: 'Netherlands Antilles',
  ar: 'Argentina',
  at: 'Austria',
  au: 'Australia',
  bb: 'Barbados',
  be: 'Belgium',
  bg: 'Bulgaria',
  br: 'Brazil',
  by: 'Belarus',
  ca: 'Canada',
  ch: 'Switzerland',
  cl: 'Chile',
  cn: 'China',
  co: 'Colombia',
  cu: 'Cuba',
  cz: 'Czech Republic',
  dc: 'Digital comics',
  de: 'Germany',
  dk: 'Denmark',
  dz: 'Algeria',
  ec: 'Ecuador',
  ee: 'Estonia',
  eg: 'Egypt',
  es: 'Spain',
  fi: 'Finland',
  fo: 'Faroe Islands',
  fr: 'France',
  gr: 'Greece',
  gt: 'Guatemala',
  gy: 'Guyana',
  hk: 'Hong Kong',
  hn: 'Honduras',
  hr: 'Croatia',
  hu: 'Hungary',
  id: 'Indonesia',
  ie: 'Ireland',
  il: 'Israel',
  in: 'India',
  ir: 'Iran',
  is: 'Iceland',
  it: 'Italy',
  jp: 'Japan',
  kr: 'South Korea',
  kw: 'Kuwait',
  lb: 'Lebanon',
  lt: 'Lithuania',
  lu: 'Luxembourg',
  lv: 'Latvia',
  ma: 'Morocco',
  mk: 'North Macedonia',
  mn: 'Mongolia',
  mx: 'Mexico',
  my: 'Malaysia',
  nl: 'Netherlands',
  no: 'Norway',
  nz: 'New Zealand',
  pa: 'Panama',
  pe: 'Peru',
  ph: 'Philippines',
  pl: 'Poland',
  pt: 'Portugal',
  ro: 'Romania',
  rs: 'Serbia',
  ru: 'Russia',
  sa: 'Saudi Arabia',
  se: 'Sweden',
  sg: 'Singapore',
  si: 'Slovenia',
  sk: 'Slovakia',
  sv: 'El Salvador',
  th: 'Thailand',
  tn: 'Tunisia',
  tr: 'Turkey',
  tw: 'Taiwan',
  ua: 'Ukraine',
  uk: 'United Kingdom',
  us: 'United States',
  uy: 'Uruguay',
  ve: 'Venezuela',
  vn: 'Vietnam',
  yu: 'Yugoslavia',
  za: 'South Africa',
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

test(`${LEGACY_REEXPORT} renvoie vers src/core sans table propre`, () => {
  const source = fs.readFileSync(path.join(rootDir, LEGACY_REEXPORT), 'utf8');
  assert.match(source, /export \* from '\.\.\/\.\.\/src\/core\/inducks\/inducks\.mjs'/);
  assert.doesNotMatch(source, /COUNTRY_NAMES\s*=/, 'seconde table de pays réintroduite');
});

test('Canada se résout en Canada, jamais en CA', () => {
  // Régression explicite : le bug observé en production.
  const table = readJsTable(JS_TABLES[0]);
  assert.equal(table.ca, 'Canada');
});