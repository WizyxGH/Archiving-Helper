#!/usr/bin/env node
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArchiveOrgInput,
  searchArchiveOrg,
  getItemDetails,
  selectItemFiles,
  downloadArchiveOrgItems,
  runArchiveOrgAcquisition,
  parseRangeSelection,
} from '../src/pipelines/1_acquisition/archive_org.mjs';
import { colorize } from '../src/core/terminal.mjs';
import { collectionDirectory } from '../src/core/config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ask(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

export async function main() {
  const args = process.argv.slice(2);
  let targetInput = null;
  let preference = 'hd';
  let convertToCbz = false;
  let limit = 20;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format' && args[i + 1]) {
      preference = args[++i].toLowerCase();
    } else if (arg === '--convert-cbz') {
      convertToCbz = true;
    } else if (arg === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10) || 20;
    } else if (!arg.startsWith('--') && !targetInput) {
      targetInput = arg;
    }
  }

  if (!targetInput) {
    console.log(`
======================================================================
  🏛️ ARCHIVE.ORG DOWNLOADER - BDs, MAGAZINES & LIVRES (PDF / CBZ)
======================================================================
`);
    console.log('Vous pouvez coller :');
    console.log('  • Une URL de recherche (ex: https://archive.org/search?query=Disney+Adventures&tab=all)');
    console.log('  • Une URL de tome/détails (ex: https://archive.org/details/disney-adventures-magazine...)');
    console.log('  • Une URL de collection (ex: https://archive.org/details/fav-...)');
    console.log('  • Ou simplement des mots-clés (ex: Disney Adventures)\n');

    targetInput = await ask('Collez l\'URL ou entrez votre recherche : ');
  }

  if (!targetInput) {
    console.log(colorize('\n[!] Aucune entrée fournie.', 'yellow'));
    return;
  }

  const parsed = parseArchiveOrgInput(targetInput);
  if (!parsed) {
    console.log(colorize('\n[!] Entrée invalide.', 'red'));
    return;
  }

  const outputDir = path.join(collectionDirectory(), 'Archive_Org');

  // Interactive selection if it's a search
  if (parsed.type === 'search') {
    console.log(`\nRecherche des tomes sur Archive.org pour "${parsed.query}"...`);
    const searchRes = await searchArchiveOrg(parsed.query, { rows: limit, mediatype: 'texts' });

    if (searchRes.items.length === 0) {
      console.log(colorize(`\n[!] Aucun résultat trouvé pour "${parsed.query}".`, 'yellow'));
      return;
    }

    console.log(`\nRésultats trouvés (${searchRes.items.length}/${searchRes.total}) :`);
    console.log('----------------------------------------------------------------------');
    searchRes.items.forEach((item, idx) => {
      const year = item.year ? `(${item.year})` : '';
      const dls = item.downloads ? `[${item.downloads} dls]` : '';
      console.log(`  [${String(idx + 1).padStart(2, ' ')}] ${item.title || item.identifier} ${year} ${dls}`);
    });
    console.log('----------------------------------------------------------------------');

    const selStr = await ask(`\nQuels tomes télécharger ? [Entrée = Tous, ou ex: 1-5, 1,3] : `);
    const selectedIndices = parseRangeSelection(selStr, searchRes.items.length);

    if (selectedIndices.length === 0) {
      console.log('Aucun tome sélectionné.');
      return;
    }

    const chosenItems = selectedIndices.map((idx) => searchRes.items[idx]);
    console.log(`\n${chosenItems.length} tome(s) sélectionné(s).`);

    const prefAns = await ask('Format souhaité [1 = Scan HD original (défaut), 2 = Text/OCR compressé, 3 = CBZ si dispo] : ');
    if (prefAns === '2') preference = 'text';
    else if (prefAns === '3') preference = 'cbz';
    else preference = 'hd';

    const convAns = await ask('Convertir automatiquement les PDF en CBZ ? [o/N] : ');
    convertToCbz = convAns.trim().toLowerCase() === 'o' || convAns.trim().toLowerCase() === 'oui' || convAns.trim().toLowerCase() === 'y';

    const finalDownloadEntries = [];
    console.log('\n[>] Récupération des fichiers pour les tomes sélectionnés...');
    for (let i = 0; i < chosenItems.length; i++) {
      const it = chosenItems[i];
      process.stdout.write(`\r  [${i + 1}/${chosenItems.length}] Analyse : ${it.identifier.slice(0, 45)}...`);
      try {
        const details = await getItemDetails(it.identifier);
        const selected = selectItemFiles(details, preference);
        for (const f of selected) finalDownloadEntries.push(f);
      } catch (err) {}
    }
    console.log(`\n[OK] ${finalDownloadEntries.length} fichier(s) prêt(s) au téléchargement.\n`);

    if (finalDownloadEntries.length === 0) {
      console.log(colorize('[!] Aucun fichier téléchargeable trouvé pour la sélection.', 'yellow'));
      return;
    }

    await downloadArchiveOrgItems(finalDownloadEntries, outputDir, {
      preference,
      convertToCbz,
    });
  } else {
    // Single item or direct link
    const convAns = await ask('Convertir automatiquement les PDF en CBZ ? [o/N] : ');
    convertToCbz = convAns.trim().toLowerCase() === 'o' || convAns.trim().toLowerCase() === 'oui' || convAns.trim().toLowerCase() === 'y';

    await runArchiveOrgAcquisition(targetInput, {
      outputDir,
      preference,
      convertToCbz,
    });
  }
}

if (process.argv[1] && process.argv[1].endsWith('download_archive_org.mjs')) {
  main().catch((err) => {
    console.error(colorize(`\n[!] Erreur : ${err.message}`, 'red'));
    process.exit(1);
  });
}
