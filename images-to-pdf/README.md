# Images → PDF

Assemble toutes les images d'un dossier en un seul fichier PDF via ImageMagick.

## Prérequis

- [ImageMagick](https://imagemagick.org/) installé et accessible dans le `PATH` (`magick`)

## Utilisation

1. **Double-clique** sur `images-to-pdf.bat`
2. Entre le chemin du dossier contenant les images quand demandé
3. Le PDF est généré dans le dossier courant sous le nom `result.pdf`

## Formats d'image supportés

`jpg`, `jpeg`, `png`, `bmp`, `tiff`, `webp`

## Notes

- Les images sont traitées dans l'ordre alphabétique par extension puis par nom de fichier
- Si un `result.pdf` existait déjà, il est écrasé
- Les fichiers temporaires (`temp_N.pdf`) sont supprimés automatiquement
