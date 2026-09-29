#!/usr/bin/env node
import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { downloadWebComic } from '../pipelines/1_acquisition/web_comic.mjs';
import { crawlBlogspotScans } from '../pipelines/1_acquisition/blogspot.mjs';
import { downloadLinksFile } from '../pipelines/1_acquisition/downloader.mjs';
import { repairAndRepackToCbz } from '../core/archive.mjs';
import { syncInducksDatabase, resolveInducksPublication } from '../core/inducks/inducks.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../..');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

function clearScreen() {
  process.stdout.write('\x1Bc');
}

async function showMainMenu() {
  while (true) {
    clearScreen();
    console.log(`
======================================================================
  📦 ARCHIVING HELPER - SUITE D'AUTOMATISATION & ARCHIVAGE DE BDS
======================================================================

  [1] 🌐 Télécharger un tome depuis un lecteur Web (ComicMafia HD -> CBZ)
  [2] 📁 Télécharger les liens depuis files.txt (Multi-sources & aria2c)
  [3] 🔍 Scanner / Scraper des scans complets depuis un Blogspot
  [4] 🛠️ Réparer / Désanonymiser une archive ou dossier (Vers CBZ Inducks)
  [5] 📚 Synchroniser / Tester la base de données Inducks (ISV)
  [6] 📱 Pipeline Telegram -> Drive (Audit & Téléchargement)
  [0] 🚪 Quitter

======================================================================`);

    const choice = (await ask('Votre choix [0-6] : ')).trim();

    if (choice === '1') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  🌐 TÉLÉCHARGEMENT LECTEUR WEB (HD LOSSLESS -> CBZ)`);
      console.log(`======================================================================\n`);
      const uri = (await ask('Collez l\'URL ou le bookUri (ex: Alben/UltimatePhantomias47.cbr) : ')).trim();
      if (uri) {
        console.log('');
        try {
          await downloadWebComic(uri);
        } catch (err) {
          console.error(`\n[!] Erreur : ${err.message}`);
        }
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '2') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  📁 TÉLÉCHARGEMENT DEPUIS files.txt`);
      console.log(`======================================================================\n`);
      const filesTxtPath = path.join(rootDir, 'download-files', 'files.txt');
      if (fs.existsSync(filesTxtPath)) {
        try {
          await downloadLinksFile(filesTxtPath);
        } catch (err) {
          console.error(`\n[!] Erreur : ${err.message}`);
        }
      } else {
        console.log(`[!] Fichier files.txt introuvable dans ${filesTxtPath}`);
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '3') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  🔍 CRAWLER / SCRAPER BLOGSPOT`);
      console.log(`======================================================================\n`);
      const blogUrl = (await ask('Entrez l\'URL du blogspot : ')).trim();
      if (blogUrl) {
        try {
          await crawlBlogspotScans(blogUrl);
        } catch (err) {
          console.error(`\n[!] Erreur : ${err.message}`);
        }
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '4') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  🛠️ RÉPARATION ET DÉSANONYMISATION CBZ INDUCKS`);
      console.log(`======================================================================\n`);
      let inputPath = (await ask('Glissez-déposez le fichier ou dossier ici : ')).trim();
      inputPath = inputPath.replace(/^["']|["']$/g, '');
      if (inputPath) {
        try {
          await repairAndRepackToCbz(inputPath);
        } catch (err) {
          console.error(`\n[!] Erreur : ${err.message}`);
        }
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '5') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  📚 BASE DE DONNÉES INDUCKS (SYNC & TEST DE RÉSOLUTION)`);
      console.log(`======================================================================\n`);
      try {
        await syncInducksDatabase(true);
        const testName = (await ask('Entrez un nom de tome à tester (ex: Picsou Magazine 550) : ')).trim();
        if (testName) {
          const res = await resolveInducksPublication(testName);
          console.log('\nRésultat de la résolution :');
          console.log(JSON.stringify(res, null, 2));
        }
      } catch (err) {
        console.error(`\n[!] Erreur : ${err.message}`);
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '6') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  📱 PIPELINE TELEGRAM -> DRIVE`);
      console.log(`======================================================================\n`);
      console.log('Lancement du script Telegram Pipeline...');
      // Executing telegram pipeline
      const { spawnSync } = await import('child_process');
      const pyScript = path.join(rootDir, 'download-files', 'telegram_to_drive_pipeline.py');
      spawnSync('python', [pyScript], { stdio: 'inherit' });
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '0') {
      clearScreen();
      console.log('\nAu revoir !\n');
      rl.close();
      process.exit(0);
    }
  }
}

showMainMenu().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
