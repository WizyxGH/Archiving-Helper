#!/usr/bin/env node
import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { colorize } from '../core/terminal.mjs';

import { downloadWebComic } from '../pipelines/1_acquisition/web_comic.mjs';
import { crawlBlogspotScans } from '../pipelines/1_acquisition/blogspot.mjs';
import { downloadLinksFile } from '../pipelines/1_acquisition/downloader.mjs';
import { repairAndRepackToCbz } from '../core/archive.mjs';
import { syncInducksDatabase, resolveInducksPublication } from '../core/inducks/inducks.mjs';
import { getCollectionDirectory } from '../pipelines/5_sheets_update/collection_csv.mjs';
import { targetArchivePath } from '../core/config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

async function askArchiveFormat() {
  const selection = (await ask('Format [CBR/CBZ, défaut CBR] : ')).trim().toLowerCase();
  return selection === 'cbz' ? 'cbz' : 'cbr';
}

function getTelegramAuditReportPath() {
  // Le CSV se pose toujours à côté de la racine d'archivage, quel que soit
  // l'emplacement configuré (TARGET_ARCHIVE_PATH ou son défaut).
  const targetRoot = targetArchivePath();
  return path.join(path.dirname(path.resolve(targetRoot)), 'audit_skipped_files.csv');
}

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

  [1] 🌐 Télécharger un tome depuis un lecteur Web (CBR par défaut, CBZ au choix)
  [2] 📁 Télécharger les liens depuis files.txt (Multi-sources & aria2c)
  [3] 🔍 Scanner / Scraper des scans complets depuis un Blogspot
  [4] 🛠️ Réparer / Désanonymiser une archive ou dossier (Vers CBZ Inducks)
  [5] 📚 Synchroniser / Tester la base de données Inducks (ISV)
  [6] 📱 Pipeline Telegram -> Drive (Audit & Téléchargement)
  [7] 📄 Afficher le rapport d'audit Telegram
  [8] 📤 Examiner les paquets Inducks en attente
  [0] 🚪 Quitter

======================================================================`);

    const choice = (await ask('Votre choix [0-8] : ')).trim();

    if (choice === '1') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  🌐 TÉLÉCHARGEMENT LECTEUR WEB (HD LOSSLESS)`);
      console.log(`======================================================================\n`);
      const uri = (await ask('Collez l\'URL ou le bookUri (ex: Alben/UltimatePhantomias47.cbr) : ')).trim();
      if (uri) {
        const archiveFormat = await askArchiveFormat();
        console.log('');
        try {
          await downloadWebComic(uri, undefined, null, { archiveFormat });
        } catch (err) {
          console.error(colorize(`\n[!] Erreur : ${err.message}`, 'red'));
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
        const archiveFormat = await askArchiveFormat();
        try {
          await downloadLinksFile(filesTxtPath, { archiveFormat });
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

    } else if (choice === '7') {
      clearScreen();
      const reportPath = getTelegramAuditReportPath();
      console.log('======================================================================');
      console.log('  📄 RAPPORT D’AUDIT TELEGRAM');
      console.log('======================================================================\n');

      if (!fs.existsSync(reportPath)) {
        console.log(`Rapport introuvable : ${reportPath}`);
        console.log('Lancez d’abord le pipeline Telegram en mode audit pour le générer.');
      } else {
        const viewer = spawn('explorer.exe', [reportPath], { detached: true, stdio: 'ignore' });
        viewer.on('error', (err) => console.error(`Impossible d’ouvrir le rapport : ${err.message}`));
        viewer.unref();
        console.log(`Rapport ouvert : ${reportPath}`);
      }

      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '8') {
      clearScreen();
      const pendingDirectory = path.join(getCollectionDirectory(), 'inducks_upload_pending');
      console.log('======================================================================');
      console.log('  📤 PAQUETS INDUCKS À CONFIRMER');
      console.log('======================================================================\n');

      if (!fs.existsSync(pendingDirectory)) {
        console.log('Aucun paquet Inducks en attente.');
      } else {
        const bundles = fs.readdirSync(pendingDirectory, { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .map(entry => entry.name);
        if (bundles.length === 0) {
          console.log('Aucun paquet Inducks en attente.');
        } else {
          for (const bundle of bundles) console.log(`  • ${bundle}`);
          const confirmation = (await ask('\nOuvrir le dossier pour vérifier et téléverser manuellement ? (O/N) : ')).trim();
          if (/^o(ui)?$/i.test(confirmation)) {
            const viewer = spawn('explorer.exe', [pendingDirectory], { detached: true, stdio: 'ignore' });
            viewer.on('error', (err) => console.error(`Impossible d’ouvrir le dossier : ${err.message}`));
            viewer.unref();
            console.log(`\nDossier ouvert : ${pendingDirectory}`);
          }
        }
      }

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
