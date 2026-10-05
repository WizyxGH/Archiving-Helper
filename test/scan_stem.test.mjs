/**
 * Garde-fou : un nom de scan se résout en numéro Inducks exact, ou pas du tout.
 *
 * Bug d'origine : « GHL_M_2 » (publication fr/GHL, numéro « M  2 », sans
 * préfixe pays) était lu comme pays « GHL » + publication « M ». Le tome partait
 * dans un dossier « GHL/GHL M » au lieu de « France/Albums histoires longues ».
 *
 * Les données Inducks sont un mini-extrait écrit dans un dossier temporaire :
 * le test ne dépend ni du poste ni du disque D:.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ISSUES = [
  'issuecode^issuerangecode^publicationcode^issuenumber^title^size^pages^',
  'fr/GHLM  2^fr/GHLM^fr/GHL^M  2^Le cycle des magiciens - I^^58^',
  'fr/GHLX   2^fr/GHLX^fr/GHL^X   2^Divers^^80^',
  'fr/PMHS S5^^fr/PMHS^S5^^^100^',
  'it/TL 3524^^it/TL^3524^^^200^',
  // Même numéro sans pays dans deux pays : le pays implicite est ambigu.
  'dk/ZZ  7^^dk/ZZ^7^^^30^',
  'no/ZZ  7^^no/ZZ^7^^^30^',
].join('\n');

const ENTRIES = [
  'entrycode^issuecode^storycode^x^x^position^x^x^title^',
  'fr/GHLM  2a^fr/GHLM  2^fr/GHLM  2a^^^a^^^Couverture^',
  'fr/GHLM  2b^fr/GHLM  2^br/AVD 23b^^^p003^^^Histoire^',
].join('\n');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inducks-fixture-'));
fs.writeFileSync(path.join(dataDir, 'inducks_issue.isv'), ISSUES);
fs.writeFileSync(path.join(dataDir, 'inducks_entry.isv'), ENTRIES);
process.env.INDUCKS_DATA_DIR = dataDir;

const { resolveScanStem, entriesForIssue } = await import('../src/core/inducks/issue_index.mjs');

test('GHL_M_2 : publication à sous-séries, pays implicite', () => {
  const issue = resolveScanStem('GHL_M_2');
  assert.equal(issue.issueCode, 'fr/GHLM  2');
  assert.equal(issue.publicationCode, 'fr/GHL');
  assert.equal(issue.canonicalStem, 'fr_GHL_M_2');
});

test('le nom officiel se résout vers lui-même', () => {
  assert.equal(resolveScanStem('fr_GHL_M_2').canonicalStem, 'fr_GHL_M_2');
  assert.equal(resolveScanStem('GHL_X_2').canonicalStem, 'fr_GHL_X_2');
});

test('les noms déjà officiels ne sont pas renommés', () => {
  assert.equal(resolveScanStem('fr_PMHS_S5').canonicalStem, 'fr_PMHS_S5');
  assert.equal(resolveScanStem('it_TL_3524').canonicalStem, 'it_TL_3524');
});

test('aucune devinette : inconnu ou ambigu -> null', () => {
  assert.equal(resolveScanStem('GHL_M_99'), null);
  assert.equal(resolveScanStem('XX_ZZZ_9'), null);
  assert.equal(resolveScanStem('ZZ_7'), null, 'dk/ZZ 7 et no/ZZ 7 : pays impossible à choisir');
  assert.equal(resolveScanStem('4379b0e82640498da01af59573fac55f'), null);
});

test('le sommaire d\'un numéro composé est retrouvé', async () => {
  const entries = await entriesForIssue(resolveScanStem('GHL_M_2'));
  assert.deepEqual(entries.map((entry) => entry.position), ['p003', 'a']);
});

function findPython() {
  return ['py', 'python'].find((candidate) => {
    try {
      execFileSync(candidate, ['-c', 'import telethon'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  });
}

/** Exécute du Python avec le module du pipeline importé sous le nom `p`. */
function runPipelinePython(python, lines, args = []) {
  const script = [
    'import sys; sys.path.insert(0, sys.argv[1])',
    'from pathlib import Path',
    'import telegram_to_drive_pipeline as p',
    ...lines,
  ].join('\n');
  return execFileSync(python, ['-c', script, path.join(rootDir, 'download-files'), ...args], { encoding: 'utf8' })
    .trim().split(/\r?\n/)
    // Le pipeline horodate chaque ligne affichée (« [20:48:47] ... »).
    .map((line) => line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, ''));
}

test('le pipeline Python ne crée jamais de dossier pour un faux code pays', (t) => {
  const python = findPython();
  if (!python) return t.skip('Python avec Telethon indisponible');

  const library = fs.mkdtempSync(path.join(os.tmpdir(), 'library-'));
  const output = runPipelinePython(python, [
    'cat = p.InducksCatalog.__new__(p.InducksCatalog)',
    'cat.root_dir = Path(sys.argv[2]); cat.code_to_folder = {}; cat.publication_titles = {}',
    'for name in sys.argv[3:]: print(cat.resolve_destination(name).relative_to(cat.root_dir))',
  ], [library, 'GHL_M_2.cbr', 'ca_OP_4.cbr', 'eg_MMP_11.cbr']);

  assert.equal(output[0], 'Unknown');
  assert.match(output[1], /^Canada[\\/]/);
  assert.match(output[2], /^Egypt[\\/]/);
});

test('l\'extension suit le contenu : un ZIP nommé .cbr devient .cbz', (t) => {
  const python = findPython();
  if (!python) return t.skip('Python avec Telethon indisponible');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'formats-'));
  const files = { 'zip.cbr': 'PK\u0003\u0004rest', 'rar.cbz': 'Rar!\u001a\u0007', 'other.cbr': '%PDF-1.4' };
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content, 'latin1');

  const output = runPipelinePython(python, [
    'for name in sys.argv[3:]: print(p.archive_extension_from_content(Path(sys.argv[2]) / name))',
  ], [directory, ...Object.keys(files)]);

  assert.deepEqual(output, ['.cbz', '.cbr', 'None']);
});

test('les pays en « p » ne sont plus pris pour un nom générique', (t) => {
  const python = findPython();
  if (!python) return t.skip('Python avec Telethon indisponible');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'headers-'));
  const headers = {
    'polish.cbr': 'Rar!\u001a\u0007\u0001\u0000\u000epl_GM_14_2.jpg',
    'portuguese.cbr': 'Rar!\u001a\u0007\u0001\u0000\u000ept_DEG_29_2.jpg',
    'generic.cbr': 'Rar!\u001a\u0007\u0001\u0000\u000epage_001_2.jpg',
  };
  for (const [name, content] of Object.entries(headers)) fs.writeFileSync(path.join(directory, name), content, 'latin1');

  const output = runPipelinePython(python, [
    'for name in sys.argv[3:]: print(p.identify_inducks_stem_from_header(Path(sys.argv[2]) / name))',
  ], [directory, ...Object.keys(headers)]);

  assert.deepEqual(output, ['pl_GM_14', 'pt_DEG_29', 'None']);
});

test('menu et pipeline écrivent l\'audit au même endroit, hors bibliothèque', async (t) => {
  const python = findPython();
  if (!python) return t.skip('Python avec Telethon indisponible');

  const { auditDirectory, targetArchivePath } = await import('../src/core/config.mjs');
  const [pythonAudit] = runPipelinePython(python, [
    'print(p.PipelineConfig.from_env().audit_file.parent)',
  ]);

  assert.equal(path.resolve(pythonAudit).toLowerCase(), auditDirectory().toLowerCase());
  const library = path.parse(targetArchivePath()).root.toLowerCase();
  assert.ok(!auditDirectory().toLowerCase().startsWith(library) || library === path.parse(rootDir).root.toLowerCase(),
    `l'audit ne doit pas être écrit sur le disque de la bibliothèque (${library})`);
});
