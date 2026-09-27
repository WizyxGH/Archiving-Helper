# Conversion PDF vers JPG

`pdf-to-jpg.mjs` est un outil autonome pour extraire les pages JPEG intégrées dans un PDF,
sans effectuer de rendu à une résolution arbitraire.

## Utilisation sous Windows

Glisse-dépose un seul PDF sur `convert-pdf-to-jpgs.bat`.

Node.js doit être installé et accessible dans le `PATH`. Les JPGs sont créés dans un dossier
`<nom-du-PDF>_jpg`, à côté du PDF. Le dossier de sortie ne doit pas déjà exister.

En ligne de commande :

```powershell
node .\pdf-to-jpg.mjs "C:\chemin\mon-numero.pdf"
node .\pdf-to-jpg.mjs "C:\chemin\mon-numero.pdf" --output-dir "C:\chemin\images"
node .\pdf-to-jpg.mjs "C:\chemin\mon-numero.pdf" --output-name "{name}_{page:03d}"
node .\pdf-to-jpg.mjs "C:\chemin\mon-numero.pdf" --archive cbz
node .\pdf-to-jpg.mjs "C:\chemin\mon-numero.pdf" --archive cbr --keep-jpgs
node .\pdf-to-jpg.mjs "C:\chemin\mon-numero.pdf" --workers 4
```

## Options

| Option | Description |
|--------|-------------|
| `--output-dir <dir>` | Dossier de sortie des JPGs (créé automatiquement) |
| `--output-name <template>` | Template du nom de fichier (voir ci-dessous) |
| `--archive cbr\|cbz` | Crée une archive après extraction (CBR ou CBZ) |
| `--keep-jpgs` | Conserve le dossier de JPGs après création de l'archive |
| `--workers <n>` | Nombre de workers parallèles (1–32, défaut : auto) |

### Nommage personnalisé (`--output-name`)

Le template contrôle le nom de chaque fichier JPG produit (`.jpg` est ajouté automatiquement) :

| Placeholder | Description | Exemple |
|-------------|-------------|---------|
| `{name}` | Nom du PDF sans extension | `JM2045` |
| `{page}` | Numéro de page (1-based) | `7` |
| `{page:03d}` | Numéro zéro-paddé sur N chiffres | `007` |
| `{total}` | Nombre total de pages | `52` |
| `{date}` | Date ISO `YYYY-MM-DD` | `2026-09-27` |
| `{year}` | Année 4 chiffres | `2026` |
| `{month}` | Mois 2 chiffres (01–12) | `09` |
| `{day}` | Jour 2 chiffres (01–31) | `27` |

Défaut : `{name}_{page:04d}` → `mon-numero_0001.jpg`, `mon-numero_0002.jpg`, …

### Archives (`--archive`)

| Format | Extension | Prérequis | Optimisation |
|--------|-----------|-----------|--------------|
| `cbz` | `.cbz` | PowerShell (inclus dans Windows) | ZIP stockage (`-m0`) |
| `cbr` | `.cbr` | [WinRAR](https://www.winrar.fr/) installé | RAR stockage (`-m0`) |

L'archive est créée **à côté du PDF** (ou dans le dossier parent de `--output-dir`).
Le dossier de JPGs est **supprimé automatiquement** après archivage, sauf si `--keep-jpgs` est utilisé.

> **Pourquoi « stockage » (-m0) ?**
> Les JPEG sont déjà compressés. Les recompresser n'économise rien mais ralentirait l'opération.
> Le CBZ/CBR résultant est donc aussi petit que possible sans toucher aux données JPEG.

## Fonctionnement et limites

- Les pages simples contenant une image JPEG sont extraites dans l'ordre du PDF, sans décodage ni
  réencodage.
- Si le PDF décrit une zone visible plus petite que l'image intégrée, elle est recadrée sans perte
  sur la grille JPEG, comme dans InducksScanUploader.
- Les images extraites sont optimisées sans changer les coefficients JPEG ; les métadonnées privées
  sont supprimées lorsque l'optimisation le permet.
- Les PDF chiffrés, pages vectorielles, JPEG 2000 et pages contenant plusieurs images ne sont pas
  rendus. Si une page ne peut pas être extraite, le programme échoue explicitement et ne garde
  aucune sortie partielle.
- Un dossier de sortie existant n'est jamais écrasé.

## Architecture

```
convert-pdf-to-jpg/
  package/                    ← package npm @starl/pdf-to-jpg-core
    src/
      index.mjs               ← API publique : createIsu, loadCore, formatOutputName
      pdf-core.js             ← source de référence partagée (IIFE, compatible browser)
      jpeg-core.js            ← source de référence partagée (IIFE, compatible browser)
    package.json
    README.md
  pdf-to-jpg.mjs              ← CLI Node.js
  jpeg-worker.mjs             ← worker de parallélisation JPEG
  convert-pdf-to-jpgs.bat     ← lanceur Windows
  sync-to-inducks.ps1         ← synchronise les sources vers InducksScanUploader
  .npmrc                      ← config GitHub Packages
```

## Package partagé `@starl/pdf-to-jpg-core`

`pdf-core.js` et `jpeg-core.js` dans `package/src/` sont les sources de référence communes au
convertisseur et à l'extension InducksScanUploader.

### Synchroniser les fichiers vers InducksScanUploader

Après avoir modifié `package/src/pdf-core.js` ou `package/src/jpeg-core.js`, exécute :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\sync-to-inducks.ps1
```

Le script copie les sources vers `pdf.js` et `jpegcrop.js` dans InducksScanUploader,
vérifie leur syntaxe, et lance les tests de régression PDF.
