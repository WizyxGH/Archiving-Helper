import path from 'node:path';
import { colorize } from '../../core/terminal.mjs';
import { collectionDirectory } from '../../core/config.mjs';
import { downloadWebComic } from './web_comic.mjs';
import { crawlBlogspotScans } from './blogspot.mjs';
import {
  parseArchiveOrgInput,
  searchArchiveOrg,
  getItemDetails,
  selectItemFiles,
  downloadArchiveOrgItems,
  runArchiveOrgAcquisition,
  parseRangeSelection,
} from './archive_org.mjs';

/**
 * Detects the input category:
 * - 'archive_org' (Archive.org URL or plain text query like 'Disney Adventures')
 * - 'blogspot' (Blogspot / Blogger URL)
 * - 'web_comic' (Comic viewer / bookUri)
 * - 'direct' (Other HTTP/HTTPS direct URL)
 */
export function detectInputType(input) {
  const clean = (input || '').trim().replace(/^["']|["']$/g, '');
  if (!clean) return null;

  if (/archive\.org/i.test(clean)) {
    return 'archive_org';
  }

  if (/blogspot\.(com|[a-z]{2,3})/i.test(clean) || /blogger\.com/i.test(clean)) {
    return 'blogspot';
  }

  if (
    /comic-viewer|bookUri=|comicmafia\.to\/reader|\/reader\/\w+/i.test(clean) ||
    /^[a-zA-Z0-9_\-\/]+\.(cbr|cbz)$/i.test(clean)
  ) {
    return 'web_comic';
  }

  if (/^https?:\/\//i.test(clean)) {
    return 'direct';
  }

  // Plain text query: treated as search on Archive.org
  return 'archive_org';
}

/**
 * Executes acquisition for any supported URL or query with interactive prompts if available.
 */
export async function runUnifiedAcquisition(input, options = {}, ask = null) {
  const clean = (input || '').trim().replace(/^["']|["']$/g, '');
  if (!clean) throw new Error('Entrée vide ou non fournie.');

  const type = detectInputType(clean);

  // ─── 1. ARCHIVE.ORG ──────────────────────────────────────────────────────────
  if (type === 'archive_org') {
    const parsed = parseArchiveOrgInput(clean);
    const outputDir = options.outputDir || path.join(collectionDirectory(), 'Archive_Org');

    if (parsed.type === 'search' && ask) {
      console.log(`\nRecherche sur Archive.org pour "${parsed.query}"...`);
      const searchRes = await searchArchiveOrg(parsed.query, { rows: options.limit || 25, mediatype: 'texts' });

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
      let preference = 'hd';
      if (prefAns.trim() === '2') preference = 'text';
      else if (prefAns.trim() === '3') preference = 'cbz';

      const convAns = await ask('Convertir automatiquement les PDF en CBZ ? [o/N] : ');
      const convertToCbz = /^o(ui)?|y(es)?$/i.test(convAns.trim());

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
      console.log(`\n[OK] ${finalDownloadEntries.length} fichier(s) sélectionné(s).\n`);

      if (finalDownloadEntries.length > 0) {
        await downloadArchiveOrgItems(finalDownloadEntries, outputDir, { preference, convertToCbz });
      }
      return;
    }

    // Direct item or non-interactive search
    let convertToCbz = Boolean(options.convertToCbz);
    if (ask && !('convertToCbz' in options)) {
      const convAns = await ask('Convertir automatiquement les PDF en CBZ ? [o/N] : ');
      convertToCbz = /^o(ui)?|y(es)?$/i.test(convAns.trim());
    }

    return await runArchiveOrgAcquisition(clean, {
      outputDir,
      preference: options.preference || 'hd',
      convertToCbz,
    });
  }

  // ─── 2. BLOGSPOT ─────────────────────────────────────────────────────────────
  if (type === 'blogspot') {
    return await crawlBlogspotScans(clean);
  }

  // ─── 3. WEB COMIC VIEWER ─────────────────────────────────────────────────────
  if (type === 'web_comic') {
    let archiveFormat = options.archiveFormat || 'cbr';
    if (ask && !options.archiveFormat) {
      const selection = (await ask('Format [CBR/CBZ, défaut CBR] : ')).trim().toLowerCase();
      archiveFormat = selection === 'cbz' ? 'cbz' : 'cbr';
    }
    return await downloadWebComic(clean, options.outputDir, null, { archiveFormat });
  }

  // ─── 4. DIRECT HTTP / 1FICHIER / MEDIAFIRE ──────────────────────────────────
  if (type === 'direct') {
    console.log(`\n[>] Lien direct détecté : ${clean}`);
    const outDir = options.outputDir || collectionDirectory();
    // Use aria2c or direct downloader
    const { downloadLinksFile } = await import('./downloader.mjs');
    const tempFile = path.join(outDir, `.single_url_${Date.now()}.txt`);
    const fs = await import('node:fs/promises');
    await fs.writeFile(tempFile, clean, 'utf8');
    try {
      await downloadLinksFile(tempFile, options);
    } finally {
      await fs.unlink(tempFile).catch(() => {});
    }
  }
}
