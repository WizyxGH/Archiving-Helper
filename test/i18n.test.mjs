import test from 'node:test';
import assert from 'node:assert/strict';
import { getLanguage, setLanguage, t, detectSystemLanguage } from '../src/core/i18n.mjs';

test('i18n detects language and defaults to fr or en', () => {
  const lang = detectSystemLanguage();
  assert.ok(lang === 'fr' || lang === 'en', `Expected 'fr' or 'en', got ${lang}`);
});

test('i18n translates menu keys correctly in fr and en', () => {
  setLanguage('fr');
  assert.equal(getLanguage(), 'fr');
  assert.ok(t('app_title').includes('ARCHIVAGE DE BDS'));

  setLanguage('en');
  assert.equal(getLanguage(), 'en');
  assert.ok(t('app_title').includes('COMIC AUTOMATION'));
});

test('i18n handles parameter interpolation', () => {
  setLanguage('fr');
  const msgFr = t('file_not_found', { path: 'mon_fichier.txt' });
  assert.equal(msgFr, 'Fichier introuvable : mon_fichier.txt');

  setLanguage('en');
  const msgEn = t('file_not_found', { path: 'my_file.txt' });
  assert.equal(msgEn, 'File not found: my_file.txt');
});
