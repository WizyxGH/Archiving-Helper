# 📦 Archiving Helper

Suite complète d'automatisation rapide et légère pour le téléchargement, la conversion, le nettoyage et l'archivage haute fidélité de bandes dessinées (comics, BD franco-belges, Disney).

---

## 🚀 Menu Interactif (`src/cli/menu.mjs`)

Le point d'entrée principal du projet est le menu interactif unifié :

```sh
node src/cli/menu.mjs
```

### Options disponibles :

| Option | Catégorie | Fonctionnalité | Description |
|:---:|---|---|---|
| **[1]** | 📥 Acquisition | 🌐 **Téléchargement unifié** | Archive.org, blogs Blogspot, lecteurs web en ligne, liens directs HTTP/HTTPS. |
| **[2]** | 📥 Acquisition | 📁 **Téléchargement multi-liens (`files.txt`)** | Batch accéléré avec *aria2c*, déchiffrement DLC/Click'n'Load, résolution 1fichier. |
| **[3]** | 📥 Acquisition | 📱 **Pipeline Telegram ➔ Drive** | Audit préventif, téléchargement automatisé, calcul SHA-256, détection et purge sécurisée des doublons identiques. |
| **[4]** | 🔄 Conversion | 📄 **Convertir PDF en JPG / CBZ / CBR** | Extraction d'images sans perte (*pdfimages*) et compression optionnelle en CBZ/CBR. |
| **[5]** | 🔄 Conversion | 📚 **Convertir CBR en CBZ** | Décompression RAR et réassemblage en ZIP/CBZ standard sans altérer les images. |
| **[6]** | 🔄 Conversion | 🖼️ **Convertir WebP en JPG** | Conversion par lot de WebP vers JPEG haute qualité (95%) via *ImageMagick*. |
| **[7]** | 🔄 Conversion | 📑 **Assembler des images en PDF** | Fusionne toutes les images d'un dossier en un PDF ordonné (*ImageMagick*). |
| **[8]** | 🔄 Traitement | 📂 **Extraire et aplatir des archives** | Décompression par lot (CBR, CBZ, RAR, ZIP) et aplatissement des sous-dossiers. |
| **[9]** | 🔄 Traitement | 🧹 **Supprimer les filigranes PDF (pikepdf)** | Nettoyage chirurgical sans perte des filigranes BAT / Spécimen Glénat en ~0,2s par tome. |
| **[10]** | 🏛️ Inducks | 🛠️ **Réparation & Canonisation Inducks** | Normalise les noms d'archives, répare les CBZ/CBR et résout le code Inducks canonique. |
| **[11]** | 🏛️ Inducks | 🔄 **Synchroniser Disque D: ➔ Registre Inducks** | Scanne le disque `D:\Duckburg Archives` et met à jour instantanément `inducks_collection.csv`. |
| **[12]** | 🏛️ Inducks | 📚 **Synchronisation ISV Inducks** | Met à jour et indexe localement les tables ISV officielles Inducks (`inducks_issue.isv`, etc.). |
| **[13]** | 🏛️ Inducks | 📤 **Examiner les paquets Inducks** | Visualise les paquets d'upload prêts à être partagés sur Inducks.org. |

---

## 🗂️ Outils & Modules Spécialisés

| Dossier / Script | Rôle | Technologies clés |
|---|---|---|
| [`download-files/`](download-files/) | Téléchargeur batch ultra-rapide, scrapers Archive.org/Blogspot, résolveur 1fichier, pipeline Telegram | Node.js, Python (*Telethon*), *aria2c* |
| [`src/core/pdf_watermark_remover.py`](src/core/pdf_watermark_remover.py) | Suppression directe des calques et pages de filigrane sans réencodage JPEG | Python, *pikepdf* |
| [`convert-pdf-to-jpg/`](convert-pdf-to-jpg/) | Extraction sans perte des images de PDF vers JPEG / CBZ / CBR | Node.js, `pdfimages` |
| [`convert-webp-to-jpg/`](convert-webp-to-jpg/) | Conversion par lot WebP vers JPG sans artefacts | ImageMagick |
| [`images-to-pdf/`](images-to-pdf/) | Assemblage d'images en document PDF unifié | ImageMagick |
| [`extract-archives/`](extract-archives/) | Extraction par lot et aplatissement des sous-dossiers imbriqués (CBR, CBZ, ZIP, RAR) | WinRAR |
| [`src/pipelines/4_inducks_collection/`](src/pipelines/4_inducks_collection/) | Synchronisation et indexation automatique du stockage physique vers le registre | Node.js, ISV Indexer |

Tous les outils disposent également de lanceurs Windows `.bat` compatibles **glisser-déposer** (drag-and-drop).

---

## 📊 Registre Numérique & Schéma de Collection Inducks

L'inventaire complet de la collection numérique et physique est maintenu dans :
- **Fichier CSV** : `download-files/files_downloads/inducks_collection.csv`
- **Cache JSON** : `download-files/files_downloads/.inducks_collection.json`

### Structure des Colonnes (Format Normalisé) :

| Colonne | Type / Format | Exemple | Description |
|---|---|---|---|
| `canonical_stem` | Chaîne | `fr_JM_1000` | Nom de fichier canonique Inducks (pays_publication_numéro). |
| `inducks_issue_code` | Chaîne | `fr/JM 1000` | Code d'identification officiel Inducks. |
| `country` | Code ISO (2 lettres) | `fr`, `be`, `it`, `us` | Code pays en minuscules. |
| `publication` | Code court | `JM`, `MMN`, `TL` | Code de publication épuré (sans préfixe pays/slash). |
| `issue_number` | Chaîne | `1000`, `1992-08` | Numéro du tome ou millésime. |
| `format` | Chaîne | `cbz`, `cbr`, `pdf` | Format de l'archive numérique. |
| `archive_path` | Chemin absolu | `D:\Duckburg Archives\...` | Emplacement physique sur le disque (vide si le tome n'est pas encore archivé). |
| `archive_size_bytes` | Entier | `45182904` | Taille en octets du fichier sur le disque (`0` si manquant). |
| `image_count` | Entier | `68` | Nombre de pages / planches scannées. |
| `sha256` | Hash hexadécimal | `e3b0c442...` | Empreinte d'intégrité SHA-256. |
| `status` | Énumération | `registered`, `missing` | Statut du tome (`registered` = présent sur le disque physique ; `missing` = absent ou à télécharger). |
| `comment` | Texte libre | `[archive.org] Pages 10/11 coupées` | Notes de complétude, qualité, source ou particularités physiques. |
| `updated_at` | Horodatage ISO | `2026-10-10T20:00:00.000Z` | Date et heure de dernière mise à jour. |

> [!NOTE]
> **Distinction Physique vs Manquant** : Grâce à la colonne `status` (`registered` vs `missing`) et au champ `archive_path`, la collection répertorie **l'ensemble** des tomes souhaités tout en visualisant instantanément ceux qui sont déjà physiquement sur le disque et ceux restant à acquérir.

---

## 🔒 Confidentialité & Git

Toutes les données personnelles, chemins locaux, commentaires privés et bases de collection sont **strictement exclus** du suivi de version Git via le [`.gitignore`](.gitignore) :
- `*.csv` / `*.tsv`
- `.inducks_collection.json`
- `*collection*.json` / `*collection*.csv`
- Fichiers `.env` et sessions Telegram (`*.session`)

Vos données privées ne seront jamais envoyées par inadvertance lors d'un `git push`.

---

## ⚙️ Configuration & Variables d'Environnement

La configuration s'effectue via le fichier `download-files/.env` (ou variables d'environnement système). Consultez `download-files/.env.example` pour voir toutes les options.

| Variable | Rôle | Valeur par défaut |
|---|---|---|
| `TARGET_ARCHIVE_PATH` | Racine de la bibliothèque sur le disque dur | `D:\Duckburg Archives\Disney comics` |
| `INDUCKS_DATA_DIR` | Dossier contenant les fichiers `inducks_*.isv` | `data/inducks` ou base locale extraite |
| `INDUCKS_COLLECTION_DIR` | Dossier du registre CSV et paquets d'upload | `download-files/files_downloads` |
| `AUDIT_DIR` | Rapports d'audit et journaux Telegram | `INDUCKS_COLLECTION_DIR` |
| `RAR_EXECUTABLE` | Emplacement de l'exécutable WinRAR (`Rar.exe`) | Détection automatique dans le `PATH` / `Program Files` |
| `PYTHON_FOR_TELEGRAM` | Interpréteur Python spécifique (Telethon, pikepdf) | Détection automatique |

Pour surcharger ponctuellement un chemin sans modifier le `.env` :
```sh
TARGET_ARCHIVE_PATH=E:\AutreDisque node src/cli/menu.mjs
```

---

*Archiving Helper — Automatisation haute performance pour la préservation numérique.*
