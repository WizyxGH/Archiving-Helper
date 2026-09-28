import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { downloadBlogspotPost, crawlBlogspotBlog } from './src/blogspot.mjs';

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
    console.log('  BLOGSPOT / BLOGGER COMIC DOWNLOADER & SCRAPER');
    console.log('======================================================');
    targetUrl = await prompt('\nEntrez l\'URL de l\'article ou du blog Blogspot : ');
  }

  if (!targetUrl) {
    console.log('[!] Aucune URL fournie.');
    process.exit(1);
  }

  // Check if it's a single post or a whole blog
  const isSinglePost = /\.html($|\?)/i.test(targetUrl);

  if (isSinglePost) {
    const result = await downloadBlogspotPost(targetUrl);
    if (result.cloudLinks && result.cloudLinks.length > 0) {
      console.log(`\n[+] Liens de telechargement direct trouves dans l'article :`);
      result.cloudLinks.forEach(l => console.log('  -', l));
      
      const save = await prompt('\nVoulez-vous ajouter ces liens a files.txt ? (O/n) : ');
      if (save === '' || save.toLowerCase() === 'o' || save.toLowerCase() === 'oui' || save.toLowerCase() === 'y') {
        fs.appendFileSync(FILES_TXT_PATH, '\n' + result.cloudLinks.join('\n') + '\n', 'utf-8');
        console.log(`[OK] Liens ajoutes a ${path.basename(FILES_TXT_PATH)}`);
      }
    }
  } else {
    // Whole blog
    const posts = await crawlBlogspotBlog(targetUrl);
    if (posts.length === 0) {
      console.log('[!] Aucun article trouve sur ce blog.');
      return;
    }

    console.log(`\nQue souhaitez-vous faire avec les ${posts.length} articles repertories ?`);
    console.log(' [1] Extraire tous les liens de telechargement (Mediafire, Archive.org...) vers files.txt');
    console.log(' [2] Telecharger et creer les archives .CBR de tous les articles avec planches');
    console.log(' [3] Choisir un article specifique a telecharger');
    console.log(' [4] Annuler');

    const choice = await prompt('\nVotre choix (1-4) : ');

    if (choice === '1') {
      console.log(`\n[>] Extraction des liens de telechargement sur ${posts.length} articles...`);
      const allExtractedLinks = [];
      for (let i = 0; i < posts.length; i++) {
        process.stdout.write(`\r  ... [${i + 1}/${posts.length}] Analyse : ${posts[i].title.substring(0, 40)}`);
        try {
          const res = await downloadBlogspotPost(posts[i].url, { concurrency: 1 });
          if (res.cloudLinks) {
            for (const l of res.cloudLinks) {
              if (!allExtractedLinks.includes(l)) {
                allExtractedLinks.push(l);
              }
            }
          }
        } catch (e) {}
      }

      console.log(`\n\n[OK] ${allExtractedLinks.length} liens de tomes complets trouves !`);
      fs.appendFileSync(FILES_TXT_PATH, '\n# Liens extraits de ' + targetUrl + '\n' + allExtractedLinks.join('\n') + '\n', 'utf-8');
      console.log(`[OK] Liens ajoutes avec succes a : ${FILES_TXT_PATH}`);
      console.log(`[Conseil] Vous pouvez maintenant lancer Option [2] dans download-files.bat pour tout telecharger a pleine vitesse.`);
    } else if (choice === '2') {
      for (let i = 0; i < posts.length; i++) {
        console.log(`\n--- Article [${i + 1}/${posts.length}] : ${posts[i].title} ---`);
        try {
          await downloadBlogspotPost(posts[i].url);
        } catch (err) {
          console.warn(`[!] Erreur sur ${posts[i].url}:`, err.message);
        }
      }
    } else if (choice === '3') {
      console.log('\nListe des 20 premiers articles :');
      posts.slice(0, 20).forEach((p, idx) => console.log(` [${idx + 1}] ${p.title}`));
      const num = await prompt('\nNumero de l\'article a telecharger : ');
      const idx = parseInt(num, 10) - 1;
      if (idx >= 0 && idx < posts.length) {
        await downloadBlogspotPost(posts[idx].url);
      } else {
        console.log('[!] Numero invalide.');
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
