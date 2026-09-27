# Extraction d'archives

Extrait automatiquement tous les fichiers CBR, CBZ, ZIP et RAR d'un dossier, et simplifie la structure des sous-dossiers.

## Prérequis

- [WinRAR](https://www.winrar.fr/) installé dans `C:\Program Files\WinRAR\`

## Configuration

Édite les variables en haut du script avant de l'utiliser :

```bat
set "WINRAR_PATH=C:\Program Files\WinRAR\WinRAR.exe"
set "INPUT_FOLDER=C:\chemin\vers\mes\archives"
set "EXTENSIONS=.cbr .cbz .zip .rar"
```

## Fonctionnement

1. Parcourt tous les fichiers du dossier `INPUT_FOLDER`
2. Pour chaque archive reconnue, crée un sous-dossier du même nom et extrait dedans
3. **Flatten** : si le contenu extrait ne contient qu'un seul sous-dossier, remonte les fichiers d'un niveau (évite la double imbrication)
4. Affiche le nombre de fichiers dans chaque dossier final

## Utilisation

Double-clique sur `extract-archives.bat` après avoir configuré les variables.
