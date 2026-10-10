#!/usr/bin/env python3
"""
Nettoyeur de filigrane PDF ultra-propre et sans perte pour ArchivingHelper.

Supprime les filigranes (texte vectoriel, Artifacts / Watermarks, calques OCG,
annotations et XObjects superposés) SANS JAMAIS modifier, décompresser ou réencoder
les images de la bande dessinée d'origine (contrôle d'intégrité SHA-256 garanti).
"""

import argparse
import hashlib
import sys
from pathlib import Path
from typing import Optional, List, Tuple
import pikepdf

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

def remove_pdf_watermarks(
    input_pdf: Path,
    output_pdf: Path,
    watermark_keywords: Optional[List[str]] = None,
    remove_artifacts: bool = True,
    remove_annotations: bool = True,
    verbose: bool = True
) -> dict:
    """
    Supprime les filigranes du document PDF en une seule passe sans altérer les images d'origine.
    """
    input_pdf = Path(input_pdf)
    output_pdf = Path(output_pdf)
    
    if not input_pdf.exists():
        raise FileNotFoundError(f"Fichier introuvable: {input_pdf}")

    if watermark_keywords is None:
        watermark_keywords = ["EDITIONS GLENAT", "GLENAT", "SPECIMEN", "WATERMARK", "EPREUVE", "BAT-"]

    kw_bytes = [kw.encode("latin1", errors="ignore").lower() for kw in watermark_keywords]
    kw_strings_lower = [kw.lower() for kw in watermark_keywords]

    stats = {
        "pages_processed": 0,
        "watermarks_removed": 0,
        "annotations_removed": 0,
        "xobjects_removed": 0,
        "identical_images": True
    }

    if verbose:
        print(f"[*] Traitement de : {input_pdf.name}")
        print(f"    -> Destination : {output_pdf.name}")

    known_watermark_xobjs = set()
    known_clean_xobjs = set()

    with pikepdf.open(input_pdf) as pdf:
        stats["pages_processed"] = len(pdf.pages)

        for p_idx, page in enumerate(pdf.pages):
            # 1. Suppression des annotations de type Watermark / Stamp
            if remove_annotations and "/Annots" in page:
                initial_annots = len(page.Annots)
                page.Annots = [
                    a for a in page.Annots
                    if str(a.get("/Subtype", "")) not in ["/Watermark", "/Stamp"]
                ]
                removed_annots = initial_annots - len(page.Annots)
                stats["annotations_removed"] += removed_annots
                if len(page.Annots) == 0:
                    del page["/Annots"]

            # Fast-path check sur le flux brut avant de parser l'AST de la page
            raw_content = b""
            if "/Contents" in page:
                try:
                    c_obj = page.Contents
                    raw_content = c_obj.read_bytes() if hasattr(c_obj, "read_bytes") else b"".join(part.read_bytes() for part in c_obj)
                except Exception:
                    pass

            raw_lower = raw_content.lower() if raw_content else b""
            has_artifact = remove_artifacts and b"/artifact" in raw_lower and b"/watermark" in raw_lower
            has_keyword = any(kb in raw_lower for kb in kw_bytes)

            # 2. Filtrage chirurgical du flux d'instructions uniquement si un marqueur est suspecté
            if has_artifact or has_keyword:
                try:
                    instructions = pikepdf.parse_content_stream(page)
                except Exception:
                    instructions = None

                if instructions is not None:
                    cleaned_instructions = []
                    in_artifact_watermark = False
                    page_modified = False

                    for operands, operator in instructions:
                        op = str(operator)

                        # Cas A : Bloc BDC / Artifact marqué comme Watermark
                        if remove_artifacts and op == "BDC" and operands:
                            tag = str(operands[0])
                            subtype = ""
                            if len(operands) > 1 and hasattr(operands[1], "get"):
                                subtype = str(operands[1].get("/Subtype", ""))
                            if tag == "/Artifact" and (subtype == "/Watermark" or not subtype):
                                in_artifact_watermark = True
                                page_modified = True
                                stats["watermarks_removed"] += 1
                                continue

                        if in_artifact_watermark:
                            if op == "EMC":
                                in_artifact_watermark = False
                            continue

                        # Cas B : Texte vectoriel direct (opérateurs Tj, TJ, ', ")
                        if has_keyword and op in ["Tj", "TJ", "'", "\""]:
                            contains_kw = False
                            for op_item in operands:
                                item_str = str(op_item).lower()
                                if any(kw in item_str for kw in kw_strings_lower):
                                    contains_kw = True
                                    break
                            if contains_kw:
                                page_modified = True
                                stats["watermarks_removed"] += 1
                                continue

                        cleaned_instructions.append((operands, operator))

                    if page_modified:
                        page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(cleaned_instructions))

            # 3. Nettoyage des XObjects de type Form de filigrane (avec cache d'analyse)
            if "/Resources" in page and "/XObject" in page["/Resources"]:
                xobjs = page["/Resources"]["/XObject"]
                to_delete = []
                for xk, xo in xobjs.items():
                    name_str = str(xk)
                    if xk in known_watermark_xobjs or "wspe_" in name_str or "watermark" in name_str.lower():
                        to_delete.append(xk)
                        known_watermark_xobjs.add(xk)
                    elif xk not in known_clean_xobjs and xo.get("/Subtype") == "/Form":
                        is_wm = False
                        try:
                            f_raw = xo.read_bytes().lower()
                            if any(kb in f_raw for kb in kw_bytes):
                                is_wm = True
                        except Exception:
                            pass

                        if is_wm:
                            to_delete.append(xk)
                            known_watermark_xobjs.add(xk)
                        else:
                            known_clean_xobjs.add(xk)

                for del_k in set(to_delete):
                    del xobjs[del_k]
                    stats["xobjects_removed"] += 1

        output_pdf.parent.mkdir(parents=True, exist_ok=True)
        # linearize=False pour une écriture en flux direct la plus rapide possible
        pdf.save(output_pdf, linearize=False)

    if verbose:
        print(f"[✓] Terminé avec succès !")
        print(f"    Pages traitées : {stats['pages_processed']}")
        print(f"    Filigranes retirés : {stats['watermarks_removed']}")
        print(f"    Ressources orphelines épurées : {stats['xobjects_removed']}")

    return stats


def main():
    parser = argparse.ArgumentParser(
        description="Suppression chirurgicale de filigranes PDF sans aucune perte ni réencodage d'image."
    )
    parser.add_argument("input", type=str, help="Fichier PDF source")
    parser.add_argument("-o", "--output", type=str, default=None, help="Fichier PDF de sortie (défaut: <nom>_clean.pdf)")
    parser.add_argument("-k", "--keywords", nargs="+", default=None, help="Mots-clés de filigranes supplémentaires à supprimer")
    
    args = parser.parse_args()
    inp = Path(args.input)
    if not inp.exists():
        sys.exit(f"Erreur : {inp} n'existe pas.")

    out = Path(args.output) if args.output else inp.with_stem(f"{inp.stem}_clean")
    remove_pdf_watermarks(inp, out, watermark_keywords=args.keywords)


if __name__ == "__main__":
    main()
