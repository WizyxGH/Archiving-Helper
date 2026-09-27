# Conversion PDF vers JPG

`pdf-to-jpg.mjs` est un outil autonome pour extraire les pages JPEG intégrées dans un PDF,
sans effectuer de rendu à une résolution arbitraire.

## Utilisation sous Windows

Glisse-dépose un seul PDF sur `convert-pdf-to-jpgs.bat`.

Node.js doit être installé et accessible dans le `PATH`. Les JPG sont créés dans un dossier
`<nom-du-PDF>_jpg`, à côté du PDF. Le dossier de sortie ne doit pas déjà exister.

En ligne de commande :

```powershell
node .\pdf-to-jpg.mjs "C:\chemin\mon-numero.pdf"
node .\pdf-to-jpg.mjs "C:\chemin\mon-numero.pdf" --output-dir "C:\chemin\images"
node .\pdf-to-jpg.mjs "C:\chemin\mon-numero.pdf" --workers 4
```

L'optimisation JPEG sans perte reste toujours activée. Pour les PDF d'au moins quatre pages, elle
est parallélisée par défaut sur plusieurs cœurs (jusqu'à quatre workers). `--workers <nombre>`
permet de régler ce nombre entre 1 et 32 ; `--workers 1` garde l'optimisation, mais la fait en
séquentiel.

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

## Synchroniser les optimisations avec InducksScanUploader

`pdf-core.js` et `jpeg-core.js` dans ce dossier sont les sources de référence communes au
convertisseur et à l'extension. Après les avoir modifiés, exécute :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\sync-to-inducks.ps1
```

Le script met à jour `pdf.js` et `jpegcrop.js` dans InducksScanUploader, puis lance les tests de
régression PDF. Il ne recopie rien d'autre et n'altère pas la logique propre à l'extension.
