import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArchiveOrgInput,
  parseRangeSelection,
  selectItemFiles,
} from '../src/pipelines/1_acquisition/archive_org.mjs';

test('parseArchiveOrgInput identifie correctement les URLs et requêtes', () => {
  // 1. URL de recherche standard (query param)
  const search1 = parseArchiveOrgInput('https://archive.org/search?query=Disney+Adventures&tab=all');
  assert.equal(search1.type, 'search');
  assert.equal(search1.query, 'Disney Adventures');

  // 2. URL de recherche (q param)
  const search2 = parseArchiveOrgInput('https://archive.org/search.php?q=Picsou+Magazine');
  assert.equal(search2.type, 'search');
  assert.equal(search2.query, 'Picsou Magazine');

  // 3. URL de détails d\'un item
  const item = parseArchiveOrgInput('https://archive.org/details/disney-adventures-magazine-volume-02-number-07-may-1992');
  assert.equal(item.type, 'item');
  assert.equal(item.identifier, 'disney-adventures-magazine-volume-02-number-07-may-1992');

  // 4. URL de téléchargement direct
  const file = parseArchiveOrgInput('https://archive.org/download/disney-adventures-vol-1/magazine.pdf');
  assert.equal(file.type, 'direct_file');
  assert.equal(file.identifier, 'disney-adventures-vol-1');
  assert.equal(file.filename, 'magazine.pdf');

  // 5. Mots-clés bruts
  const keywords = parseArchiveOrgInput('Disney Adventures 1992');
  assert.equal(keywords.type, 'search');
  assert.equal(keywords.query, 'Disney Adventures 1992');

  // 6. Entrée vide
  assert.equal(parseArchiveOrgInput(''), null);
});

test('parseRangeSelection gère les plages, listes et "all"', () => {
  // Tout sélectionner
  assert.deepEqual(parseRangeSelection('', 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(parseRangeSelection('all', 3), [0, 1, 2]);

  // Plage '1-3'
  assert.deepEqual(parseRangeSelection('1-3', 5), [0, 1, 2]);

  // Numéros isolés '1, 4'
  assert.deepEqual(parseRangeSelection('1, 4', 5), [0, 3]);

  // Combinaison '1-2, 5'
  assert.deepEqual(parseRangeSelection('1-2, 5', 5), [0, 1, 4]);

  // Hors limites ignorés
  assert.deepEqual(parseRangeSelection('0, 2, 99', 5), [1]);
});

test('selectItemFiles sélectionne le format approprié selon la préférence', () => {
  const mockItem = {
    identifier: 'disney-adv-1',
    files: [
      {
        name: 'issue_hd.pdf',
        format: 'Image Container PDF',
        size: 500000000,
        source: 'original',
        isPdf: true,
        isCbz: false,
        isImageContainer: true,
        isTextPdf: false,
        downloadUrl: 'https://archive.org/download/disney-adv-1/issue_hd.pdf',
      },
      {
        name: 'issue_text.pdf',
        format: 'Additional Text PDF',
        size: 25000000,
        source: 'derivative',
        isPdf: true,
        isCbz: false,
        isImageContainer: false,
        isTextPdf: true,
        downloadUrl: 'https://archive.org/download/disney-adv-1/issue_text.pdf',
      },
      {
        name: 'issue.cbz',
        format: 'Comic Book ZIP',
        size: 150000000,
        source: 'original',
        isPdf: false,
        isCbz: true,
        isImageContainer: false,
        isTextPdf: false,
        downloadUrl: 'https://archive.org/download/disney-adv-1/issue.cbz',
      },
    ],
  };

  // 1. Préférence 'hd' : choisit le scan HD original
  const hd = selectItemFiles(mockItem, 'hd');
  assert.equal(hd.length, 1);
  assert.equal(hd[0].name, 'issue_hd.pdf');

  // 2. Préférence 'text' : choisit le PDF OCR compressé
  const text = selectItemFiles(mockItem, 'text');
  assert.equal(text.length, 1);
  assert.equal(text[0].name, 'issue_text.pdf');

  // 3. Préférence 'cbz' : choisit l'archive CBZ
  const cbz = selectItemFiles(mockItem, 'cbz');
  assert.equal(cbz.length, 1);
  assert.equal(cbz[0].name, 'issue.cbz');

  // 4. Préférence 'all' : renvoie tous les fichiers
  const all = selectItemFiles(mockItem, 'all');
  assert.equal(all.length, 3);
});

