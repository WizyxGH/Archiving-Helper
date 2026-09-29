import fs from 'fs';
import path from 'path';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function safeFetch(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
        ...options
      });
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

/**
 * Crawls a whole Blogspot blog and collects all real comic scan download links
 */
export async function crawlBlogspotScans(blogBaseUrl) {
  let cleanBase = blogBaseUrl.replace(/\/+$/, '');
  if (!cleanBase.startsWith('http')) {
    cleanBase = `https://${cleanBase}`;
  }

  console.log(`\n======================================================`);
  console.log(`  🌐 [Blogspot Scraper] Recherche sur : ${cleanBase}`);
  console.log(`======================================================`);

  let startIndex = 1;
  const maxResults = 500;
  const allScanLinks = [];
  let totalPosts = 0;

  while (true) {
    const feedUrl = `${cleanBase}/feeds/posts/default?alt=json&start-index=${startIndex}&max-results=${maxResults}`;
    process.stdout.write(`\r[>] Lecture des métadonnées du blog (index ${startIndex})...`);

    const res = await safeFetch(feedUrl);
    if (!res.ok) break;

    const data = await res.json();
    const entries = data.feed?.entry || [];
    if (entries.length === 0) break;

    totalPosts += entries.length;

    for (const entry of entries) {
      const postTitle = entry.title?.$t || 'Sans Titre';
      const content = entry.content?.$t || '';

      const linkRegex = /href=["']([^"']+)["']/gi;
      let lm;
      while ((lm = linkRegex.exec(content)) !== null) {
        const href = lm[1].trim();
        if (/mediafire\.com|drive\.google\.com|mega\.nz|4shared\.com|archive\.org\/download|dropbox\.com|1fichier\.com|\.(cbr|cbz|pdf|zip|rar)($|\?)/i.test(href)) {
          if (!allScanLinks.some(item => item.url === href)) {
            let hoster = 'Direct';
            if (/mediafire\.com/i.test(href)) hoster = 'Mediafire';
            else if (/archive\.org/i.test(href)) hoster = 'Archive.org';
            else if (/drive\.google\.com/i.test(href)) hoster = 'Google Drive';
            else if (/4shared\.com/i.test(href)) hoster = '4Shared';
            else if (/mega\.nz/i.test(href)) hoster = 'Mega';
            else if (/1fichier\.com/i.test(href)) hoster = '1fichier';

            allScanLinks.push({
              postTitle,
              url: href,
              hoster
            });
          }
        }
      }
    }

    startIndex += entries.length;
    const totalResults = parseInt(data.feed?.openSearch$totalResults?.$t || '0', 10);
    if (startIndex > totalResults || entries.length < maxResults) {
      break;
    }
  }

  console.log(`\n\n[OK] ${totalPosts} articles analysés.`);
  console.log(`[OK] ${allScanLinks.length} fichiers de scans complets trouvés !`);
  return allScanLinks;
}
