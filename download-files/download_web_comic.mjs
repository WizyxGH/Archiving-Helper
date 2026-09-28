import { downloadWebComic } from './src/web_comic.mjs';

export { downloadWebComic };

if (process.argv[1] && process.argv[1].endsWith('download_web_comic.mjs')) {
  const uriArg = process.argv[2] || 'Alben/UltimatePhantomias48.cbr';
  downloadWebComic(uriArg)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n[!] Erreur:', err.message);
      process.exit(1);
    });
}
