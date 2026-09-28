import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { extractScansFromPost, crawlBlogspotScans } from './src/blogspot.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILES_TXT_PATH = path.resolve(__dirname, 'files.txt');

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function main() {
  let targetUrl = process.argv[2];

  if (!targetUrl) {
    console.log('======================================================');
    console.log('  RÉCUPÉRATEUR DE SCANS DE BDS DEPUIS BLOGSPOT');
    console.log('======================================================');
    targetUrl = await prompt('\nEntrez l\'URL de l\'article ou du blog Blogspot : ');
  }

  if (!targetUrl) {
    console.log('[!] Aucune URL fournie.');
    process.exit(1);
  }

  const isSinglePost = /\.html($|\?)/i.test(targetUrl);

  if (isSinglePost) {
    console.log(`\nAnalyse de l'article : ${targetUrl}`);
    const res = await extractScansFromPost(targetUrl);
    console.log(`\nArticle : "${res.title}"`);
    console.log(`Fichiers de scans détectés : ${res.scanLinks.length}`);

    if (res.scanLinks.length === 0) {
      console.log('[!] Aucun lien de scan (Mediafire, Archive.org, Drive, CBR/PDF) trouvé dans cet article.');
      return;
    }

    console.log('\nListe des scans disponibles :');
    res.scanLinks.forEach((item, idx) => {
      console.log(` [${idx + 1}] [${item.hoster}] ${item.linkText}`);
      console.log(`     -> ${item.url}`);
    });

    const choice = await prompt('\nAjouter ces liens à files.txt pour téléchargement ? (O/n) : ');
    if (choice === '' || choice.toLowerCase() === 'o' || choice.toLowerCase() === 'oui' || choice.toLowerCase() === 'y') {
      const linksToAdd = res.scanLinks.map(i => i.url).join('\n');
      fs.appendFileSync(FILES_TXT_PATH, `\n# Scans extraits de "${res.title}"\n${linksToAdd}\n`, 'utf-8');
      console.log(`[OK] Liens ajoutés à ${path.basename(FILES_TXT_PATH)} !`);
      console.log(`[Astuce] Lancez l'option [2] dans download-files.bat pour lancer le téléchargement direct.`);
    }
  } else {
    const allScans = await crawlBlogspotScans(targetUrl);

    if (allScans.length === 0) {
      console.log('[!] Aucun lien de scan trouvé sur ce blog.');
      return;
    }

    // Breakdown by hoster
    const hosterStats = {};
    for (const item of allScans) {
      hosterStats[item.hoster] = (hosterStats[item.hoster] || 0) + 1;
    }

    console.log('\nRépartition des hébergeurs de scans trouvés :');
    for (const [hoster, count] of Object.entries(hosterStats)) {
      console.log(` - ${hoster.padEnd(15)} : ${count} tomes/fichiers`);
    }

    console.log('\nActions :');
    console.log(` [1] Exporter tous les ${allScans.length} liens de scans vers files.txt`);
    console.log(` [2] Filtrer et exporter uniquement un hébergeur (ex: Mediafire ou Archive.org)`);
    console.log(' [3] Annuler');

    const choice = await prompt('\nVotre choix (1-3) : ');

    if (choice === '1') {
      const content = '\n# Scans extraits de ' + targetUrl + '\n' + allScans.map(s => s.url).join('\n') + '\n';
      fs.appendFileSync(FILES_TXT_PATH, content, 'utf-8');
      console.log(`\n[OK] Les ${allScans.length} liens de scans ont été enregistrés dans : ${FILES_TXT_PATH}`);
      console.log(`[Conseil] Vous pouvez lancer Option [2] dans download-files.bat pour télécharger les tomes souhaités.`);
    } else if (choice === '2') {
      const filter = await prompt('Nom de l\'hébergeur (ex: Mediafire, Archive.org) : ');
      const filtered = allScans.filter(s => s.hoster.toLowerCase().includes(filter.toLowerCase()));
      if (filtered.length > 0) {
        const content = `\n# Scans (${filter}) extraits de ${targetUrl}\n` + filtered.map(s => s.url).join('\n') + '\n';
        fs.appendFileSync(FILES_TXT_PATH, content, 'utf-8');
        console.log(`\n[OK] ${filtered.length} liens (${filter}) enregistrés dans ${FILES_TXT_PATH} !`);
      } else {
        console.log(`[!] Aucun lien trouvé pour "${filter}".`);
      }
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('download_blogspot.mjs')) {
  main().catch(err => {
    console.error('\n[!] Erreur:', err.message);
    process.exit(1);
  });
}
