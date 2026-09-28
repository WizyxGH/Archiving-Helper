import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { cleanJpegLossless } from './jpeg.mjs';
import { naturalSort } from './sorter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, '..', 'files_downloads');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 150);
}

/**
 * Transforms any Google / Blogger image URL into its highest possible native resolution (/s0/)
 */
export function toMaxResolutionUrl(url) {
  let u = url;
  u = u.replace(/\/s[0-9]+(-rw|-h)?\//i, '/s0/');
  u = u.replace(/\/w[0-9]+-h[0-9]+[^\/]*\//i, '/s0/');
  u = u.replace(/\/d\//i, '/s0/');
  return u;
}

/**
 * Safe fetch with auto-retry on HTTP 429 / 5xx
 */
async function safeFetch(url, options = {}, retries = 4, backoffMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          ...(options.headers || {})
        },
        ...options
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt === retries) return res;
        await new Promise(r => setTimeout(r, backoffMs * attempt));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, backoffMs * attempt));
    }
  }
}

/**
 * Scrapes and packages a single Blogspot post as a lossless .cbr comic
 */
export async function downloadBlogspotPost(postUrl, options = {}) {
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n======================================================`);
  console.log(`[Blogspot] Analyse du post : ${postUrl}`);
  console.log(`======================================================`);

  const res = await safeFetch(postUrl);
  if (!res.ok) {
    throw new Error(`Impossible de charger la page (HTTP ${res.status})`);
  }
  const html = await res.text();

  // Extract Title
  let title = 'Blogspot_Comic';
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/[-|].*$/, '').trim();
  }
  title = sanitizeFilename(title);

  // Extract download / cloud links (Mediafire, Mega, Drive, Archive.org, 4Shared, CBR, PDF)
  const linkRegex = /href=["']([^"']+)["']/gi;
  let lm;
  const cloudLinks = [];
  while ((lm = linkRegex.exec(html)) !== null) {
    const href = lm[1];
    if (/mediafire\.com|drive\.google\.com|mega\.nz|4shared\.com|archive\.org\/download|dropbox\.com|1fichier\.com|\.(cbr|cbz|pdf|zip|rar)($|\?)/i.test(href)) {
      if (!cloudLinks.includes(href)) {
        cloudLinks.push(href);
      }
    }
  }

  // Extract comic image URLs
  const imgRegex = /src=["']([^"']+)["']/gi;
  let im;
  const rawImages = [];
  while ((im = imgRegex.exec(html)) !== null) {
    const src = im[1];
    if (/blogger\.googleusercontent\.com|bp\.blogspot\.com|googleusercontent\.com/i.test(src)) {
      if (/favicon|s16-h|s35-c|w72-h72|avatar|Mickey\+lOGO/i.test(src)) continue;
      const maxResUrl = toMaxResolutionUrl(src);
      if (!rawImages.includes(maxResUrl)) {
        rawImages.push(maxResUrl);
      }
    }
  }

  console.log(`[+] Titre detecte : ${title}`);
  if (cloudLinks.length > 0) {
    console.log(`[+] Liens de telechargement direct / cloud detectes : ${cloudLinks.length}`);
  }
  console.log(`[+] Planches d'images Blogspot detectees : ${rawImages.length}`);

  // If there are comic images embedded directly, download and pack them into .cbr
  if (rawImages.length > 1) {
    const tempDir = path.join(outputDir, `_temp_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      console.log(`\n[>] Telechargement de ${rawImages.length} planches en qualite native (s0)...`);
      const downloadedFiles = [];

      const CONCURRENCY = options.concurrency || 5;
      let currentIndex = 0;

      async function worker() {
        while (currentIndex < rawImages.length) {
          const idx = currentIndex++;
          const imgUrl = rawImages[idx];
          const pageNum = idx + 1;
          const ext = imgUrl.toLowerCase().includes('.png') ? '.png' : (imgUrl.toLowerCase().includes('.webp') ? '.webp' : '.jpg');
          const fileName = `${title}_${pageNum}${ext}`;
          const filePath = path.join(tempDir, fileName);

          try {
            const imgRes = await safeFetch(imgUrl);
            if (imgRes.ok) {
              const arrayBuf = await imgRes.arrayBuffer();
              let buf = Buffer.from(arrayBuf);
              if (ext === '.jpg') {
                buf = cleanJpegLossless(buf);
              }
              fs.writeFileSync(filePath, buf);
              downloadedFiles.push(filePath);
              process.stdout.write(`\r  ... [${downloadedFiles.length}/${rawImages.length}] Page ${pageNum} telechargee`);
            } else {
              console.warn(`\n[!] Echec page ${pageNum} (HTTP ${imgRes.status})`);
            }
          } catch (e) {
            console.warn(`\n[!] Erreur telechargement page ${pageNum}:`, e.message);
          }
          await new Promise(r => setTimeout(r, 40));
        }
      }

      const workers = Array.from({ length: CONCURRENCY }, () => worker());
      await Promise.all(workers);
      console.log(`\n[OK] Toutes les planches sont telechargees.`);

      // Package to CBR using AdmZip
      const cbrPath = path.join(outputDir, `${title}.cbr`);
      console.log(`[>] Creation de l'archive CBR : ${path.basename(cbrPath)}...`);

      const sortedFiles = naturalSort(downloadedFiles);
      const zip = new AdmZip();
      for (const f of sortedFiles) {
        zip.addLocalFile(f);
      }
      zip.writeZip(cbrPath);

      const stats = fs.statSync(cbrPath);
      console.log(`[SUCCES] BD cree avec succes : ${path.basename(cbrPath)} (${(stats.size / (1024 * 1024)).toFixed(2)} Mo)`);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {}
    }
  }

  return {
    title,
    postUrl,
    cloudLinks,
    imageCount: rawImages.length
  };
}

/**
 * Crawls a whole Blogspot blog or label via Blogger JSON Feed API
 */
export async function crawlBlogspotBlog(blogBaseUrl) {
  let cleanBase = blogBaseUrl.replace(/\/+$/, '');
  if (!cleanBase.startsWith('http')) {
    cleanBase = `https://${cleanBase}`;
  }

  console.log(`\n======================================================`);
  console.log(`[Blogspot Crawler] Exploration du blog : ${cleanBase}`);
  console.log(`======================================================`);

  let startIndex = 1;
  const maxResults = 500;
  const allPosts = [];

  while (true) {
    const feedUrl = `${cleanBase}/feeds/posts/default?alt=json&start-index=${startIndex}&max-results=${maxResults}`;
    console.log(`[>] Lecture du flux (index ${startIndex})...`);
    
    const res = await safeFetch(feedUrl);
    if (!res.ok) {
      console.warn(`[!] Fin du flux ou erreur HTTP ${res.status}`);
      break;
    }

    const data = await res.json();
    const entries = data.feed?.entry || [];
    if (entries.length === 0) break;

    for (const entry of entries) {
      const altLink = entry.link?.find(l => l.rel === 'alternate')?.href;
      const title = entry.title?.$t || 'Sans_Titre';
      if (altLink) {
        allPosts.push({ title, url: altLink });
      }
    }

    startIndex += entries.length;
    const totalResults = parseInt(data.feed?.openSearch$totalResults?.$t || '0', 10);
    if (startIndex > totalResults || entries.length < maxResults) {
      break;
    }
  }

  console.log(`[OK] Total articles/tomes repertories sur le blog : ${allPosts.length}`);
  return allPosts;
}
