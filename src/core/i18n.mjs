/**
 * Module d'internationalisation (i18n) bilingue FR / EN pour Archiving-Helper.
 * Détecte automatiquement la langue du système d'exploitation Windows / Linux / macOS
 * et supporte une surcharge via la variable d'environnement LANGUAGE=fr|en.
 */

let currentLang = null;

export function detectSystemLanguage() {
  const envLang = process.env.LANGUAGE || process.env.LANG || process.env.LC_ALL;
  if (envLang) {
    const code = envLang.trim().toLowerCase();
    if (code.startsWith('fr')) return 'fr';
    if (code.startsWith('en')) return 'en';
  }

  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale && locale.toLowerCase().startsWith('fr')) {
      return 'fr';
    }
  } catch {
    // Fallback silencieux
  }

  return 'en';
}

export function getLanguage() {
  if (!currentLang) {
    currentLang = detectSystemLanguage();
  }
  return currentLang;
}

export function setLanguage(lang) {
  if (lang === 'fr' || lang === 'en') {
    currentLang = lang;
  }
}

const translations = {
  fr: {
    // Entête & Titres généraux
    app_title: "ARCHIVING HELPER - SUITE D'AUTOMATISATION & ARCHIVAGE DE BDS",
    app_tagline: "Téléchargement, conversion sans perte, standardisation et synchronisation Inducks",
    menu_prompt: "Votre choix [0-13] : ",
    press_enter_to_continue: "Appuyez sur Entrée pour continuer...",
    quit: "🚪 Quitter",
    back_to_menu: "↩️ Retour au menu principal",
    operation_cancelled: "Opération annulée.",
    unknown_choice: "Option inconnue. Veuillez entrer un nombre valide.",

    // Sections du menu
    section_acquisition: "--- 📥 TÉLÉCHARGEMENT & ACQUISITION ---",
    section_conversion: "--- 🔄 CONVERSION & TRAITEMENT D'IMAGES / ARCHIVES ---",
    section_inducks: "--- 🏛️ GESTION & REGISTRE INDUCKS ---",

    // Options du menu
    opt_1: "🌐 Télécharger depuis un lien / URL ou recherche (Archive.org, Blogspot, Direct)",
    opt_2: "📁 Télécharger les liens depuis files.txt (Multi-sources & aria2c)",
    opt_3: "📱 Pipeline Telegram -> Drive (Audit, Écriture, Purge doublons)",
    opt_4: "📄 Convertir PDF en JPG / CBZ / CBR (Extraction sans perte)",
    opt_5: "📚 Convertir CBR en CBZ (Repack RAR -> ZIP sans perte)",
    opt_6: "🖼️ Convertir WebP en JPG (ImageMagick)",
    opt_7: "📑 Assembler des images en un seul PDF (ImageMagick)",
    opt_8: "📂 Extraire et aplatir des archives (CBR, CBZ, RAR, ZIP)",
    opt_9: "🧹 Supprimer les filigranes d'un PDF (Glénat BAT... 100% sans perte)",
    opt_10: "🛠️ Réparer / Désanonymiser une archive ou dossier (Vers CBZ Inducks)",
    opt_11: "🔄 Synchroniser Disque D: -> Collection Inducks CSV",
    opt_12: "📚 Synchroniser la base de données Inducks (ISV locale)",
    opt_13: "📤 Examiner les paquets Inducks en attente",

    // Option 1 : Téléchargement unifié
    unified_header: "  🌐 TÉLÉCHARGEMENT UNIFIÉ (Archive.org, Blogspot, Lecteur Web, Direct)",
    unified_intro: "Vous pouvez coller :\n  • Une URL ou recherche Archive.org (ex: Disney Adventures, https://archive.org/...)\n  • Une URL de blog Blogspot\n  • Une URL de lecteur de comic web (comicextra, readallcomics...)\n  • Un lien de téléchargement direct (.cbr, .cbz, .pdf, .zip)\n  • Ou appuyez sur Entrée pour revenir au menu.",
    prompt_url_or_search: "Lien, URL ou recherche : ",
    prompt_archive_format: "Format [CBR/CBZ, défaut CBR] : ",
    download_success: "Téléchargement et traitement terminés avec succès !",
    download_error: "Échec du téléchargement : {message}",

    // Option 2 : Téléchargement par liste
    list_header: "  📁 TÉLÉCHARGEMENT DEPUIS UN FICHIER DE LIENS",
    prompt_file_path: "Chemin du fichier de liens [défaut: download-files/files.txt] : ",
    file_not_found: "Fichier introuvable : {path}",
    no_links_found: "Aucun lien trouvé dans le fichier.",

    // Option 3 : Pipeline Telegram
    telegram_header: "  📱 PIPELINE TELEGRAM -> DRIVE",
    python_telethon_missing: "Interpréteur Python introuvable ou Telethon absent. Installez-le avec : pip install telethon",
    telegram_choose_mode: "Mode d'exécution :\n  [1] Lancer le pipeline complet (--resume --run)\n  [2] Audit rapide (taille, métadonnées, pas de téléchargement)\n  [3] Ouvrir le rapport d'audit CSV ({path})\n  [0] Retour",
    telegram_pipeline_success: "Pipeline Telegram terminé.",

    // Option 4 : PDF to JPG / CBZ
    pdf_header: "  📄 EXTRACTION SANS PERTE PDF VERS JPG / CBZ / CBR",
    prompt_pdf_path: "Glissez-déposez le fichier ou dossier PDF : ",
    prompt_cbz_convert: "Créer une archive après extraction ?\n  [1] CBZ (Recommandé)\n  [2] CBR\n  [3] Non (dossier JPG seul)\nVotre choix [1-3, défaut 1] : ",

    // Option 5 : CBR to CBZ
    cbr_header: "  📚 CONVERSION CBR VERS CBZ (REPACK SANS PERTE)",
    prompt_cbr_path: "Glissez-déposez le fichier ou dossier CBR [Entrée pour dossier courant] : ",
    prompt_delete_cbr: "Supprimer les fichiers .cbr originaux après conversion ? (o/n) [défaut: n] : ",

    // Option 6 : WebP to JPG
    webp_header: "  🖼️ CONVERSION WEBP VERS JPG",
    prompt_webp_path: "Glissez-déposez le dossier ou fichier WebP [Entrée pour dossier courant] : ",
    prompt_delete_webp: "Supprimer les fichiers .webp originaux après conversion ? (o/n) [défaut: n] : ",

    // Option 7 : Images to PDF
    images_to_pdf_header: "  📑 ASSEMBLER DES IMAGES EN UN SEUL PDF",
    prompt_images_dir: "Glissez-déposez le dossier contenant les images [Entrée pour dossier courant] : ",

    // Option 8 : Extraction archives
    extract_header: "  📂 EXTRACTION ET APLATISSEMENT D'ARCHIVES",
    prompt_extract_path: "Glissez-déposez le dossier ou l'archive [Entrée pour dossier courant] : ",

    // Option 9 : Suppression filigrane PDF
    watermark_header: "  🧹 SUPPRESSION DE FILIGRANES PDF (SANS PERTE D'IMAGE)",
    watermark_intro: "Supprime les textes vectoriels, Artifacts, annotations et calques superposés\ntout en garantissant des images 100% identiques bit à bit (SHA-256).",
    prompt_watermark_input: "Glissez-déposez le fichier PDF à nettoyer : ",
    prompt_watermark_output: "Chemin du fichier PDF nettoyé [Entrée pour auto-suffixe _clean] : ",
    watermark_in_progress: "Nettoyage en cours...",
    watermark_success: "Fichier nettoyé avec succès : {path}",
    watermark_error: "Erreur lors du nettoyage du filigrane : {message}",

    // Option 10 : Réparation / Désanonymisation
    repair_header: "  🛠️ RÉPARATION & STANDARDISATION EN CBZ INDUCKS",
    prompt_repair_path: "Glissez-déposez le fichier ou dossier d'archives à normaliser : ",

    // Option 11 : Sync Disque D: -> Inducks
    sync_header: "  🔄 SYNCHRONISATION DISQUE D: -> COLLECTION INDUCKS CSV",
    sync_intro: "Scanne la bibliothèque locale et met à jour inducks_collection.csv et .inducks_collection.json\navec le statut exact (registered / missing).",
    prompt_sync_dir: "Dossier racine de la collection locale [défaut: D:\\Duckburg Archives\\Disney comics] : ",
    drive_not_accessible: "Le disque ou dossier spécifié n'est pas accessible actuellement : {path}",
    sync_in_progress: "Scan et synchronisation en cours...",
    sync_complete: "Synchronisation terminée avec succès !",

    // Option 12 : Sync Base Inducks
    db_sync_header: "  📚 SYNCHRONISATION DE LA BASE DE DONNÉES INDUCKS",
    db_sync_in_progress: "Téléchargement et décompression des tables ISV Inducks...",
    db_sync_complete: "Base de données Inducks mise à jour avec succès !",

    // Option 13 : Paquets Inducks
    batches_header: "  📤 PAQUETS INDUCKS EN ATTENTE D'ENVOI",
    batches_none: "Aucun paquet en attente trouvé dans {dir}.",
    batches_found: "{count} paquet(s) trouvé(s) :"
  },

  en: {
    // App header & General titles
    app_title: "ARCHIVING HELPER - COMIC AUTOMATION & ARCHIVING SUITE",
    app_tagline: "Acquisition, lossless conversion, standardization and Inducks synchronization",
    menu_prompt: "Your choice [0-13]: ",
    press_enter_to_continue: "Press Enter to continue...",
    quit: "🚪 Quit",
    back_to_menu: "↩️ Back to main menu",
    operation_cancelled: "Operation cancelled.",
    unknown_choice: "Unknown option. Please enter a valid number.",

    // Menu sections
    section_acquisition: "--- 📥 DOWNLOAD & ACQUISITION ---",
    section_conversion: "--- 🔄 IMAGE & ARCHIVE CONVERSION / PROCESSING ---",
    section_inducks: "--- 🏛️ INDUCKS MANAGEMENT & REGISTRY ---",

    // Menu options
    opt_1: "🌐 Download from link / URL or search (Archive.org, Blogspot, Direct)",
    opt_2: "📁 Download links from files.txt (Multi-sources & aria2c)",
    opt_3: "📱 Telegram -> Drive Pipeline (Audit, Write, Duplicate purge)",
    opt_4: "📄 Convert PDF to JPG / CBZ / CBR (Lossless extraction)",
    opt_5: "📚 Convert CBR to CBZ (Lossless RAR -> ZIP repack)",
    opt_6: "🖼️ Convert WebP to JPG (ImageMagick)",
    opt_7: "📑 Assemble images into a single PDF (ImageMagick)",
    opt_8: "📂 Extract and flatten archives (CBR, CBZ, RAR, ZIP)",
    opt_9: "🧹 Remove PDF watermarks (Glénat BAT... 100% lossless)",
    opt_10: "🛠️ Repair / De-anonymize archive or folder (To Inducks CBZ)",
    opt_11: "🔄 Synchronize Drive D: -> Inducks Collection CSV",
    opt_12: "📚 Synchronize Inducks database (Local ISV tables)",
    opt_13: "📤 Review pending Inducks upload batches",

    // Option 1: Unified downloader
    unified_header: "  🌐 UNIFIED DOWNLOADER (Archive.org, Blogspot, Web Reader, Direct)",
    unified_intro: "You can paste:\n  • An Archive.org URL or search query (e.g. Disney Adventures, https://archive.org/...)\n  • A Blogspot blog URL\n  • A Web comic reader URL (comicextra, readallcomics...)\n  • A direct download link (.cbr, .cbz, .pdf, .zip)\n  • Or press Enter to return to the menu.",
    prompt_url_or_search: "Link, URL or search query: ",
    prompt_archive_format: "Format [CBR/CBZ, default CBR]: ",
    download_success: "Download and processing completed successfully!",
    download_error: "Download failed: {message}",

    // Option 2: Links list downloader
    list_header: "  📁 DOWNLOAD FROM LINKS FILE",
    prompt_file_path: "Links file path [default: download-files/files.txt]: ",
    file_not_found: "File not found: {path}",
    no_links_found: "No links found in file.",

    // Option 3: Telegram pipeline
    telegram_header: "  📱 TELEGRAM -> DRIVE PIPELINE",
    python_telethon_missing: "Python interpreter not found or Telethon missing. Install it with: pip install telethon",
    telegram_choose_mode: "Execution mode:\n  [1] Run full pipeline (--resume --run)\n  [2] Quick audit (size, metadata, no download)\n  [3] Open audit CSV report ({path})\n  [0] Back",
    telegram_pipeline_success: "Telegram pipeline completed.",

    // Option 4: PDF to JPG / CBZ
    pdf_header: "  📄 LOSSLESS PDF TO JPG / CBZ / CBR EXTRACTION",
    prompt_pdf_path: "Drag-and-drop a PDF file or folder: ",
    prompt_cbz_convert: "Create an archive after extraction?\n  [1] CBZ (Recommended)\n  [2] CBR\n  [3] No (JPG folder only)\nYour choice [1-3, default 1]: ",

    // Option 5: CBR to CBZ
    cbr_header: "  📚 CONVERT CBR TO CBZ (LOSSLESS REPACK)",
    prompt_cbr_path: "Drag-and-drop CBR file or folder [Enter for current directory]: ",
    prompt_delete_cbr: "Delete original .cbr files after conversion? (y/n) [default: n]: ",

    // Option 6: WebP to JPG
    webp_header: "  🖼️ CONVERT WEBP TO JPG",
    prompt_webp_path: "Drag-and-drop WebP file or folder [Enter for current directory]: ",
    prompt_delete_webp: "Delete original .webp files after conversion? (y/n) [default: n]: ",

    // Option 7: Images to PDF
    images_to_pdf_header: "  📑 ASSEMBLE IMAGES INTO A SINGLE PDF",
    prompt_images_dir: "Drag-and-drop image folder [Enter for current directory]: ",

    // Option 8: Extract archives
    extract_header: "  📂 EXTRACT AND FLATTEN ARCHIVES",
    prompt_extract_path: "Drag-and-drop folder or archive [Enter for current directory]: ",

    // Option 9: Remove PDF watermark
    watermark_header: "  🧹 REMOVE PDF WATERMARKS (LOSSLESS IMAGE PRESERVATION)",
    watermark_intro: "Removes vector text, Artifacts, annotations and overlay layers\nwhile strictly ensuring 100% bit-identical images (SHA-256).",
    prompt_watermark_input: "Drag-and-drop PDF file to clean: ",
    prompt_watermark_output: "Cleaned PDF destination path [Enter for auto _clean suffix]: ",
    watermark_in_progress: "Cleaning in progress...",
    watermark_success: "File successfully cleaned: {path}",
    watermark_error: "Error cleaning watermark: {message}",

    // Option 10: Repair / De-anonymize
    repair_header: "  🛠️ REPAIR & STANDARDIZE INTO INDUCKS CBZ",
    prompt_repair_path: "Drag-and-drop archive or directory to normalize: ",

    // Option 11: Sync Drive D: -> Inducks
    sync_header: "  🔄 SYNCHRONIZE DRIVE D: -> INDUCKS COLLECTION CSV",
    sync_intro: "Scans local library and updates inducks_collection.csv & .inducks_collection.json\nwith exact status (registered / missing).",
    prompt_sync_dir: "Root path of local collection [default: D:\\Duckburg Archives\\Disney comics]: ",
    drive_not_accessible: "The specified drive or path is currently not accessible: {path}",
    sync_in_progress: "Scanning and synchronizing...",
    sync_complete: "Synchronization completed successfully!",

    // Option 12: Sync Inducks DB
    db_sync_header: "  📚 SYNCHRONIZE INDUCKS DATABASE",
    db_sync_in_progress: "Downloading and extracting Inducks ISV tables...",
    db_sync_complete: "Inducks database successfully updated!",

    // Option 13: Inducks batches
    batches_header: "  📤 PENDING INDUCKS UPLOAD BATCHES",
    batches_none: "No pending batches found in {dir}.",
    batches_found: "Found {count} batch(es):"
  }
};

export function t(key, params = {}) {
  const lang = getLanguage();
  const dict = translations[lang] || translations.en;
  let text = dict[key] || translations.en[key] || key;

  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}
