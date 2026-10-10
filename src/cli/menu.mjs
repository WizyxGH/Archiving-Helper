#!/usr/bin/env node
import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { colorize } from '../core/terminal.mjs';

import { runUnifiedAcquisition } from '../pipelines/1_acquisition/unified.mjs';
import { downloadLinksFile } from '../pipelines/1_acquisition/downloader.mjs';
import { repairAndRepackToCbz } from '../core/archive.mjs';
import { syncInducksDatabase, resolveInducksPublication } from '../core/inducks/inducks.mjs';
import { getCollectionDirectory } from '../pipelines/5_sheets_update/collection_csv.mjs';
import { syncDriveToInducksCollection } from '../pipelines/4_inducks_collection/sync_drive_to_collection.mjs';
import { auditDirectory, targetArchivePath, isPathVolumeAccessible } from '../core/config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

/**
 * Trouve un interpréteur Python disposant de Telethon.
 *
 * `python` seul ne suffit pas : quand plusieurs versions sont installées, celle
 * du PATH est souvent la plus récente — et sans les dépendances du pipeline.
 * Les candidats sont donc testés un par un.
 *
 * Le résultat est mémorisé sur disque : la détection coûte quelques centaines
 * de millisecondes (un `python -c` par candidat), inutile de la répéter à
 * chaque lancement du menu. PYTHON_FOR_TELEGRAM force un interpréteur et court-
 * circuite toute détection.
 */
function pythonCandidates() {
  if (process.env.PYTHON_FOR_TELEGRAM) {
    return [{ command: process.env.PYTHON_FOR_TELEGRAM, args: [] }];
  }

  const cached = readCachedPython();
  if (cached) return [cached];

  const localAppData = process.env.LOCALAPPDATA || '';
  return [
    { command: 'python', args: [] },
    { command: 'py', args: ['-3'] },
    localAppData && {
      command: path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
      args: [],
    },
  ].filter(Boolean);
}

function readCachedPython() {
  const cacheFile = path.join(rootDir, '.cache', 'python-for-telegram.json');
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (cached?.command && canImportTelethon(cached)) return cached;
  } catch {
    // pas de cache, ou cache illisible : on repart de la détection
  }
  return null;
}

function writeCachedPython(candidate) {
  const cacheFile = path.join(rootDir, '.cache', 'python-for-telegram.json');
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(candidate), 'utf8');
  } catch {
    // Un cache non écrit ne bloque rien : on retentera au prochain lancement.
  }
}

function canImportTelethon({ command, args }) {
  const probe = spawnSync(command, [...args, '-c', 'import telethon'], { stdio: 'ignore' });
  return probe.status === 0;
}

/** Renvoie l'interpréteur à utiliser ({command, args}) ou null. */
function resolvePython() {
  for (const candidate of pythonCandidates()) {
    if (canImportTelethon(candidate)) {
      if (!process.env.PYTHON_FOR_TELEGRAM) writeCachedPython(candidate);
      return candidate;
    }
  }
  return null;
}

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
  // Même règle que le pipeline Python : AUDIT_DIR, sinon le dossier de
  // collection. Jamais sur le disque de la bibliothèque.
  return path.join(auditDirectory(), 'audit_skipped_files.csv');
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

  --- 📥 TÉLÉCHARGEMENT & ACQUISITION ---
  [1]  🌐 Télécharger depuis un lien / URL ou recherche (Archive.org, Blogspot, Direct)
  [2]  📁 Télécharger les liens depuis files.txt (Multi-sources & aria2c)
  [3]  📱 Pipeline Telegram -> Drive (Audit, Écriture, Purge doublons)

  --- 🔄 CONVERSION & TRAITEMENT D'IMAGES / ARCHIVES ---
  [4]  📄 Convertir PDF en JPG / CBZ / CBR (Extraction sans perte)
  [5]  📚 Convertir CBR en CBZ (Repack RAR -> ZIP sans perte)
  [6]  🖼️ Convertir WebP en JPG (ImageMagick)
  [7]  📑 Assembler des images en un seul PDF (ImageMagick)
  [8]  📂 Extraire et aplatir des archives (CBR, CBZ, RAR, ZIP)
  [9]  🧹 Supprimer les filigranes d'un PDF (Glénat BAT... 100% sans perte)

  --- 🏛️ GESTION & REGISTRE INDUCKS ---
  [10] 🛠️ Réparer / Désanonymiser une archive ou dossier (Vers CBZ Inducks)
  [11] 🔄 Synchroniser Disque D: -> Collection Inducks CSV
  [12] 📚 Synchroniser la base de données Inducks (ISV locale)
  [13] 📤 Examiner les paquets Inducks en attente

  [0]  🚪 Quitter

======================================================================`);

    const choice = (await ask('Votre choix [0-13] : ')).trim();

    if (choice === '1') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  🌐 TÉLÉCHARGEMENT UNIFIÉ (Archive.org, Blogspot, Lecteur Web, Direct)`);
      console.log(`======================================================================\n`);
      console.log('Vous pouvez coller :');
      console.log('  • Une URL ou recherche Archive.org (ex: Disney Adventures, https://archive.org/...)');
      console.log('  • Une URL Blogspot / Blogger (ex: https://thearabicmagazinmickeymouse.blogspot.com)');
      console.log('  • Un lien Comic Viewer ou bookUri (ex: Alben/UltimatePhantomias47.cbr)');
      console.log('  • Un lien direct HTTP/HTTPS (ex: 1fichier, Mediafire...)\n');

      const target = (await ask('Lien, URL ou mots-clés : ')).trim();
      if (target) {
        try {
          await runUnifiedAcquisition(target, {}, ask);
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
      console.log(`  📱 PIPELINE TELEGRAM -> DRIVE`);
      console.log(`======================================================================\n`);

      // Le script démarre en audit par défaut : sans option, il n'écrit rien.
      // L'utilisateur choisit donc explicitement ce qu'il autorise.
      const mode = (await ask(
        '  [1] 🔎 Mode AUDIT & SIMULATION\n' +
        '      (Compare avec le Drive, génère le rapport CSV, ne télécharge rien)\n\n' +
        '  [2] ⚡ Mode ÉCRITURE + PURGE\n' +
        '      (Télécharge les nouveaux tomes ET supprime de Telegram les doublons identiques)\n\n' +
        '  [3] ⚡ Mode ÉCRITURE SEULE (sans purge)\n' +
        '      (Télécharge les nouveaux tomes, ne supprime rien sur Telegram)\n\n' +
        '  [4] 📄 Ouvrir le rapport d\'audit\n' +
        '      (Ouvre le CSV généré par un audit précédent)\n\n' +
        '  [5] 📜 Voir le journal des exécutions\n' +
        '      (Historique des runs : date, mode, volumes, erreurs)\n\n' +
        '  [0] Retour\n\n' +
        '  Votre choix [0-5] : '
      )).trim();

      if (mode === '0' || mode === '') continue;

      if (mode === '5') {
        const logPath = path.join(
          path.dirname(getTelegramAuditReportPath()),
          'telegram_pipeline_runs.log'
        );
        console.log('\n  📜 JOURNAL DES EXÉCUTIONS\n');
        if (!fs.existsSync(logPath)) {
          console.log('  Aucun run enregistré pour l\'instant.\n');
        } else {
          const runs = fs.readFileSync(logPath, 'utf8')
            .split(/\r?\n/)
            .filter((line) => line.trim());
          for (const run of runs.slice(-20)) console.log(`  ${run}`);
          if (runs.length > 20) {
            console.log(`\n  … ${runs.length - 20} run(s) plus ancien(s) dans ${logPath}`);
          } else {
            console.log(`\n  Journal complet : ${logPath}`);
          }
          console.log('');
        }
        await ask('\nAppuyez sur Entrée pour continuer...');
        continue;
      }

      if (mode === '4') {
        const reportPath = getTelegramAuditReportPath();
        if (!fs.existsSync(reportPath)) {
          console.log(`\n  Rapport introuvable : ${reportPath}`);
          console.log('  Lancez d\'abord le mode AUDIT (option 1) pour le générer.\n');
        } else {
          const viewer = spawn('explorer.exe', [reportPath], { detached: true, stdio: 'ignore' });
          viewer.on('error', (err) => console.error(`  Impossible d'ouvrir le rapport : ${err.message}`));
          viewer.unref();
          console.log(`\n  Rapport ouvert : ${reportPath}\n`);
        }
        await ask('\nAppuyez sur Entrée pour continuer...');
        continue;
      }

      if (mode !== '1' && mode !== '2' && mode !== '3') {
        console.log('  Choix non reconnu, retour au menu.');
        continue;
      }

      const targetRoot = targetArchivePath();
      if (!isPathVolumeAccessible(targetRoot)) {
        const rootVolume = path.parse(targetRoot).root;
        console.log(colorize(`\n  [ERREUR CRITIQUE] Le lecteur '${rootVolume}' n'est pas connecté ou est inaccessible.`, 'red+bold'));
        console.log(colorize(`  Dossier cible configuré : ${targetRoot}`, 'red'));
        console.log(colorize(`  -> Le disque dur externe n'est pas branché sous Windows.`, 'yellow'));
        console.log(colorize(`  -> Branchez votre disque ou modifiez TARGET_ARCHIVE_PATH dans download-files/.env.\n`, 'yellow'));
        await ask('Appuyez sur Entrée pour continuer...');
        continue;
      }

      const runArguments = [];
      let warning = '';
      if (mode === '2') {
        warning =
          '\n  [!] Ce mode SUPPRIME de Telegram chaque tome déjà présent sur le\n' +
          '      disque avec une taille identique au byte près.\n' +
          '      Assurez-vous que la synchronisation est à jour.\n';
      } else if (mode === '3') {
        runArguments.push('--no-purge');
      }

      if (mode !== '1') {
        console.log(warning);
        const checkpointFile = path.join(getCollectionDirectory(), '.telegram_checkpoint.json');
        if (fs.existsSync(checkpointFile)) {
          try {
            const checkpointData = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
            if (checkpointData?.last_processed_msg_id) {
              const resumeAns = (await ask(
                `  Reprendre après le message #${checkpointData.last_processed_msg_id} ? [O/n] : `
              )).trim();
              if (!resumeAns || /^o(ui)?$/i.test(resumeAns)) {
                runArguments.push('--resume');
              }
            }
          } catch {}
        }

        const limitAnswer = (await ask(
          '  Limiter à combien de messages ? (vide = tous) : '
        )).trim();
        if (limitAnswer && /^\d+$/.test(limitAnswer)) {
          runArguments.push('--limit', limitAnswer);
        }
        if (!runArguments.includes('--limit')) {
          console.log('\n  [!] Mode ÉCRITURE : cela peut Concerner des milliers de fichiers.');
        }

        const confirm = (await ask(
          '\n  Tapez OUI pour lancer : '
        )).trim();
        if (confirm.toUpperCase() !== 'OUI') {
          console.log('  Annulé.\n');
          continue;
        }
        runArguments.push('--run');
      } else {
        console.log('  Lancement de l\'audit...\n');
      }

      const python = resolvePython();
      if (!python) {
        console.log('  [!] Aucun Python avec Telethon n\'a été trouvé.');
        console.log('      Installez les dépendances :');
        console.log('        pip install telethon');
        console.log('      Ou indiquez un interpréteur précis :');
        console.log('        set PYTHON_FOR_TELEGRAM=C:\\chemin\\vers\\python.exe');
        await ask('\nAppuyez sur Entrée pour continuer...');
        continue;
      }

      const pyScript = path.join(rootDir, 'download-files', 'telegram_to_drive_pipeline.py');
      // PYTHONIOENCODING force l'UTF-8 des le demarrage : sans lui, Python
      // lit la page de codes de la console (cp1252 en Windows FR) et renvoie
      // les accents encodes en "A-circumflex-e". Renforce le reconfigure() du
      // script, qui ne suffit pas quand la sortie est heritee telle quelle.
      spawnSync(python.command, [...python.args, pyScript, ...runArguments], {
        stdio: 'inherit',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '4') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  📄 CONVERSION PDF VERS JPG / CBZ / CBR (EXTRACTION SANS PERTE)`);
      console.log(`======================================================================\n`);
      console.log('Extrait les images d\'un ou plusieurs PDF sans réencodage (pdfimages natif).');
      console.log('Peut compresser automatiquement en archive CBZ ou CBR.\n');

      let inputPath = (await ask('Glissez-déposez le fichier ou dossier PDF : ')).trim();
      inputPath = inputPath.replace(/^["']|["']$/g, '');

      if (inputPath && fs.existsSync(inputPath)) {
        const archiveChoice = (await ask('Créer une archive après extraction ? [cbz/cbr/non, défaut: cbz] : ')).trim().toLowerCase();
        const format = archiveChoice === 'cbr' ? 'cbr' : archiveChoice === 'non' ? '' : 'cbz';
        const keepChoice = (await ask('Conserver le dossier des images JPG extraites ? (O/N, défaut: N) : ')).trim();
        const keepJpgs = /^o(ui)?$/i.test(keepChoice);

        const pdfScript = path.join(rootDir, 'convert-pdf-to-jpg', 'pdf-to-jpg.mjs');
        const args = [pdfScript, inputPath];
        if (format) args.push('--archive', format);
        if (keepJpgs) args.push('--keep-jpgs');

        console.log('\n  Traitement en cours...\n');
        spawnSync(process.execPath, args, { stdio: 'inherit' });
      } else if (inputPath) {
        console.log(`\n[!] Chemin introuvable : ${inputPath}`);
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '5') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  📚 CONVERSION CBR VERS CBZ (REPACK SANS PERTE)`);
      console.log(`======================================================================\n`);
      console.log('Décompresse le RAR et réassemble en ZIP/CBZ standard sans altérer les images.\n');

      let inputPath = (await ask('Glissez-déposez le fichier ou dossier CBR : ')).trim();
      inputPath = inputPath.replace(/^["']|["']$/g, '');

      if (inputPath && fs.existsSync(inputPath)) {
        const delChoice = (await ask('Supprimer les fichiers .cbr originaux après conversion ? (O/N, défaut: N) : ')).trim();
        const deleteOriginal = /^o(ui)?$/i.test(delChoice);

        const psScript = path.join(rootDir, 'convert-cbr-to-cbz', 'convert-cbr-to-cbz.ps1');
        const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript];
        if (deleteOriginal) psArgs.push('-DeleteOriginal');
        psArgs.push(inputPath);

        console.log('\n  Conversion en cours...\n');
        spawnSync('powershell.exe', psArgs, { stdio: 'inherit' });
      } else if (inputPath) {
        console.log(`\n[!] Chemin introuvable : ${inputPath}`);
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '6') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  🖼️ CONVERSION WEBP VERS JPG (IMAGEMAGICK)`);
      console.log(`======================================================================\n`);
      console.log('Convertit par lot tous les fichiers .webp en images .jpg haute qualité (95%).\n');

      let inputPath = (await ask('Glissez-déposez le fichier ou dossier contenant des WebP : ')).trim();
      inputPath = inputPath.replace(/^["']|["']$/g, '');

      if (inputPath && fs.existsSync(inputPath)) {
        const batScript = path.join(rootDir, 'convert-webp-to-jpg', 'convert-webp-to-jpg.bat');
        console.log('\n  Lancement de la conversion...\n');
        spawnSync('cmd.exe', ['/c', batScript, inputPath], { stdio: 'inherit' });
      } else if (inputPath) {
        console.log(`\n[!] Chemin introuvable : ${inputPath}`);
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '7') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  📑 ASSEMBLER DES IMAGES EN UN SEUL FICHIER PDF`);
      console.log(`======================================================================\n`);
      console.log('Regroupe toutes les images d\'un dossier en un document PDF avec tri naturel.\n');

      let inputPath = (await ask('Glissez-déposez le dossier contenant les images : ')).trim();
      inputPath = inputPath.replace(/^["']|["']$/g, '');

      if (inputPath && fs.existsSync(inputPath)) {
        const batScript = path.join(rootDir, 'images-to-pdf', 'images-to-pdf.bat');
        console.log('\n  Génération du PDF en cours...\n');
        spawnSync('cmd.exe', ['/c', batScript, inputPath], { stdio: 'inherit' });
      } else if (inputPath) {
        console.log(`\n[!] Dossier introuvable : ${inputPath}`);
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '8') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  📂 EXTRACTION ET APLATISSEMENT D'ARCHIVES (CBR, CBZ, RAR, ZIP)`);
      console.log(`======================================================================\n`);
      console.log('Extrait automatiquement les archives et aplatit les sous-dossiers inutiles.\n');

      let inputPath = (await ask('Glissez-déposez le fichier ou dossier d\'archives : ')).trim();
      inputPath = inputPath.replace(/^["']|["']$/g, '');

      if (inputPath && fs.existsSync(inputPath)) {
        const batScript = path.join(rootDir, 'extract-archives', 'extract-archives.bat');
        console.log('\n  Extraction en cours...\n');
        spawnSync('cmd.exe', ['/c', batScript, inputPath], { stdio: 'inherit' });
      } else if (inputPath) {
        console.log(`\n[!] Chemin introuvable : ${inputPath}`);
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '9') {
      clearScreen();
      console.log(`======================================================================`);
      console.log(`  🧹 SUPPRESSION DE FILIGRANES PDF (SANS PERTE / SANS RÉENCODAGE)`);
      console.log(`======================================================================\n`);
      console.log('Supprime les filigranes vectoriels, textes, et calques (Glénat, Spécimen, etc.)');
      console.log('Les images originales de la BD restent 100% intactes à l\'octet près.\n');

      let targetPdf = (await ask('Glissez-déposez le fichier PDF à nettoyer : ')).trim();
      targetPdf = targetPdf.replace(/^["']|["']$/g, '');

      if (targetPdf && fs.existsSync(targetPdf)) {
        const python = resolvePython() || 'python';
        const removerScript = path.join(rootDir, 'src', 'core', 'pdf_watermark_remover.py');
        console.log('\n  Nettoyage chirurgical en cours...\n');
        const res = spawnSync(python.command || python, [...(python.args || []), removerScript, targetPdf], {
          stdio: 'inherit',
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });
        if (res.error) {
          console.error(`\n[!] Erreur lors de l'exécution : ${res.error.message}`);
        }
      } else if (targetPdf) {
        console.log(`\n[!] Fichier introuvable : ${targetPdf}`);
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '10') {
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

    } else if (choice === '11') {
      clearScreen();
      try {
        await syncDriveToInducksCollection();
      } catch (err) {
        console.error(`\n[!] Erreur lors de la synchronisation : ${err.message}`);
      }
      await ask('\nAppuyez sur Entrée pour continuer...');

    } else if (choice === '12') {
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

    } else if (choice === '13') {
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
