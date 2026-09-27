import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DOWNLOAD_DIR = path.resolve(__dirname, 'files_downloads');
const FILES_TXT = path.resolve(__dirname, 'files.txt');

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

let links = [];
if (fs.existsSync(FILES_TXT)) {
  const content = fs.readFileSync(FILES_TXT, 'utf8');
  links = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('http'));
}

if (links.length === 0) {
  console.log('[!] Aucun lien trouvé dans files.txt');
  process.exit(1);
}

console.log('====================================================');
console.log('  Rapidgator Automated Comic Downloader');
console.log(`  Liens charges : ${links.length}`);
console.log(`  Dossier cible : ${DOWNLOAD_DIR}`);
console.log('====================================================\n');

async function processUrl(url, index, total) {
  console.log(`\n[${index + 1}/${total}] Chargement de : ${url}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    defaultViewport: null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--dns-over-https-templates=https://cloudflare-dns.com/dns-query',
      '--enable-features=DnsOverHttps',
      '--window-size=1200,850'
    ]
  });

  try {
    const page = await browser.newPage();
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD_DIR,
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Check if IP is in cooldown
    const status = await page.evaluate(() => {
      const isLimited = (typeof infobar_msg !== 'undefined' && infobar_msg.length > 0) || (typeof startTimerUrl !== 'undefined' && startTimerUrl === '');
      const limitMsg = typeof infobar_msg !== 'undefined' ? infobar_msg.replace(/<[^>]*>/g, ' ').trim() : '';
      return { isLimited, limitMsg };
    });

    if (status.isLimited) {
      console.log(`\n[!] Quota gratuit temporairement bloque sur votre adresse IP :`);
      console.log(`    "${status.limitMsg}"`);
      await browser.close();
      return { status: 'cooldown' };
    }

    console.log('[*] Clic automatique sur Telechargement Bas Debit...');
    await page.evaluate(() => {
      const btn = document.querySelector('.btn-free');
      if (btn) btn.click();
    });

    console.log('[*] Decompte de securite (45 secondes)...');
    await new Promise(r => setTimeout(r, 48000));

    console.log('[*] Page de telechargement prete ! Cochez le captcha si demande...');
    process.stdout.write('\x07');

    console.log('[*] Surveillance du dossier de telechargement...');
    let downloaded = false;
    for (let sec = 0; sec < 3600; sec += 5) {
      await new Promise(r => setTimeout(r, 5000));
      const files = fs.readdirSync(DOWNLOAD_DIR);
      const crdownloads = files.filter(f => f.endsWith('.crdownload') || f.endsWith('.tmp'));
      
      if (crdownloads.length > 0) {
        process.stdout.write(`\r[*] Telechargement en cours... (${crdownloads[0]})`);
      } else {
        const completed = files.filter(f => f.endsWith('.cbr') || f.endsWith('.cbz') || f.endsWith('.rar'));
        if (completed.length > 0) {
          console.log(`\n[+] Telechargement termine avec succes !`);
          downloaded = true;
          break;
        }
      }
    }

    await browser.close();
    return { status: downloaded ? 'success' : 'timeout' };

  } catch (err) {
    console.error(`[!] Erreur :`, err.message);
    try { await browser.close(); } catch(e) {}
    return { status: 'error', error: err.message };
  }
}

async function startQueue() {
  for (let i = 0; i < links.length; i++) {
    const res = await processUrl(links[i], i, links.length);
    if (res.status === 'cooldown') {
      console.log(`\n[*] Prochaine tentative dans 30 minutes (le temps que Rapidgator libere le creneau gratuit)...`);
      await new Promise(r => setTimeout(r, 30 * 60 * 1000));
      i--;
    } else if (res.status === 'success') {
      console.log(`\n[*] Fichier ${i + 1} termine. Attente du creneau suivant (120 minutes)...`);
      await new Promise(r => setTimeout(r, 121 * 60 * 1000));
    }
  }
}

startQueue();
