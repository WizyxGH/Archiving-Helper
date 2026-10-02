import { downloadWebComic } from './src/web_comic.mjs';
import { colorize } from '../src/core/terminal.mjs';

export { downloadWebComic };

if (process.argv[1] && process.argv[1].endsWith('download_web_comic.mjs')) {
  const uriArg = process.argv[2] || 'Alben/UltimatePhantomias48.cbr';
  const archiveFormat = process.argv[3] || 'cbr';
  downloadWebComic(uriArg, undefined, null, { archiveFormat })
    .then(() => process.exit(0))
    .catch(err => {
      console.error(colorize(`\n[!] Erreur: ${err.message}`, 'red'));
      process.exit(1);
    });
}
