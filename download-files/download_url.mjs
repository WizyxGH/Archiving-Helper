#!/usr/bin/env node
import readline from 'node:readline';
import { runUnifiedAcquisition } from '../src/pipelines/1_acquisition/unified.mjs';
import { colorize } from '../src/core/terminal.mjs';

function createAsk() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (query) => new Promise((resolve) => rl.question(query, resolve));
  ask.close = () => rl.close();
  return ask;
}

async function main() {
  const ask = createAsk();
  let input = process.argv.slice(2).join(' ').trim();

  if (!input) {
    console.log('======================================================================');
    console.log('  🌐 TÉLÉCHARGEMENT UNIFIÉ (Archive.org, Blogspot, Lecteur Web, Direct)');
    console.log('======================================================================\n');
    console.log('Vous pouvez coller :');
    console.log('  • Une URL ou recherche Archive.org (ex: Disney Adventures)');
    console.log('  • Une URL de blog ou article Blogspot / Blogger');
    console.log('  • Un lien Comic Viewer ou bookUri (ex: Alben/UltimatePhantomias48.cbr)');
    console.log('  • Un lien direct HTTP/HTTPS (1fichier, etc.)\n');
    input = (await ask('Lien, URL ou mots-clés : ')).trim();
  }

  if (!input) {
    ask.close();
    process.exit(0);
  }

  try {
    await runUnifiedAcquisition(input, {}, ask);
  } catch (err) {
    console.error(colorize(`\n[!] Erreur: ${err.message}`, 'red'));
    process.exitCode = 1;
  } finally {
    ask.close();
  }
}

main();

