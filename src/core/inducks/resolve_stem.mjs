/**
 * Résolution d'un ou plusieurs noms de scan, pour les outils hors Node.
 *
 *   node src/core/inducks/resolve_stem.mjs GHL_M_2 it_TL_3524
 *
 * Écrit un objet JSON { stem: résultat | null } sur stdout. Le pipeline Python
 * l'appelle au lieu de réimplémenter la lecture des numéros Inducks : une seule
 * logique, celle de resolveScanStem.
 */
import { resolveScanStem } from './issue_index.mjs';

const stems = process.argv.slice(2);
const results = {};
for (const stem of stems) {
  const issue = resolveScanStem(stem);
  results[stem] = issue && {
    canonicalStem: issue.canonicalStem,
    issueCode: issue.issueCode,
    publicationCode: issue.publicationCode,
    countryCode: issue.countryCode,
    pubCode: issue.pubCode,
    issueNumber: issue.issueNumber,
  };
}
process.stdout.write(JSON.stringify(results));
