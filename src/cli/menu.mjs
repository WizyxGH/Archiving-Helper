#!/usr/bin/env node
import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { colorize } from '../core/terminal.mjs';

import { downloadWebComic } from '../pipelines/1_acquisition/web_comic.mjs';
import { crawlBlogspotScans } from '../pipelines/1_acquisition/blogspot.mjs';
import { downloadLinksFile } from '../pipelines/1_acquisition/downloader.mjs';
import { repairAndRepackToCbz } from '../core/archive.mjs';
import { syncInducksDatabase, resolveInducksPublication } from '../core/inducks/inducks.mjs';
import { getCollectionDirectory } from '../pipelines/5_sheets_update/collection_csv.mjs';
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

  [1] 🌐 Télécharger un tome depuis un lecteur Web (CBR par défaut, CBZ au choix)
  [2] 📁 Télécharger les liens depuis files.txt (Multi-sources & aria2c)
  [3] 🔍 Scanner / Scraper des scans complets depuis un Blogspot
  [4] 🛠️ Réparer / Désanonymiser une archive ou dossier (Vers CBZ Inducks)
  [5] 📚 Synchroniser / Tester la base de données Inducks (ISV)
  [6] 📱 Pipeline Telegram -> Drive (Audit, Écriture, Rapport)
  [7] 📤 Examiner les paquets Inducks en attente
  [0] 🚪 Quitter

======================================================================`);

    const choice = (await ask('Votre choix [0-7] : ')).trim();

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

    } else if (choice === '7') {
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
