import fs from 'fs';
import { repairAndRepackToCbr } from './src/repair.mjs';

export { repairAndRepackToCbr };

if (process.argv[1] && process.argv[1].endsWith('repair_and_repack_cbr.mjs')) {
  const arg = process.argv[2];
  if (arg && fs.existsSync(arg)) {
    repairAndRepackToCbr(arg)
      .then(() => process.exit(0))
      .catch(err => {
        console.error('\n[!] Erreur:', err.message);
        process.exit(1);
      });
  } else {
    console.log('Usage: node repair_and_repack_cbr.mjs <archive.cbr|folder|multipart.part1.rar>');
    process.exit(1);
  }
}
