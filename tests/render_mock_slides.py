#!/usr/bin/env python3
"""
Rendu approximatif (Pillow) des diapositives enregistrées par la doublure SlidesApp
(tests/out/deck_X.json) → PNG 1600×900, comme l'export « LARGE » de l'API Slides.
Sert à vérifier visuellement la mise en page et à alimenter le test de rendu vidéo
hors ligne. Signale les textes qui débordent de leur zone.
Usage : python3 tests/render_mock_slides.py tests/out/deck_B.json tests/out/slides_B
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S = 1600 / 720
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
INSET_X, INSET_Y = 7.2, 3.6   # marges internes par défaut d'une zone de texte Slides (pt)


def wrap(d, text, font, max_w):
    lines = []
    for para in str(text).split("\n"):
        cur = ""
        for w in para.split():
            cand = (cur + " " + w).strip()
            if d.textlength(cand, font=font) <= max_w or not cur:
                cur = cand
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
    return lines


def render(deck_path, out_dir):
    deck = json.loads(Path(deck_path).read_text())
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    warnings = []
    for i, sl in enumerate(deck["slides"], 1):
        img = Image.new("RGB", (1600, 900), sl["bg"] or "#000000")
        d = ImageDraw.Draw(img)
        for sh in sl["shapes"]:
            box = [sh["x"] * S, sh["y"] * S, (sh["x"] + sh["w"]) * S, (sh["y"] + sh["h"]) * S]
            if sh["kind"] == "TEXT":
                st = sh.get("style", {})
                size = st.get("size", 14) * S * 1.333 * 0.75   # pt → px à cette échelle
                font = ImageFont.truetype(FONT_B if st.get("bold") else FONT, int(size))
                maxw = (sh["w"] - 2 * INSET_X) * S
                lines = wrap(d, sh.get("text", ""), font, maxw)
                lh = size * 1.2
                total = lh * len(lines)
                avail = (sh["h"] - 2 * INSET_Y) * S
                if total > avail + 2:
                    warnings.append(f"diapo {i} : texte trop long pour sa zone « {sh.get('text', '')[:40]} » ({len(lines)} lignes)")
                y = box[1] + INSET_Y * S + (max(0, avail - total) / 2 if sh.get("valign") == "MIDDLE" else 0)
                for ln in lines:
                    tw = d.textlength(ln, font=font)
                    x = box[0] + INSET_X * S + ((maxw - tw) / 2 if sh.get("align") == "CENTER" else 0)
                    d.text((x, y), ln, font=font, fill=st.get("color", "#FFFFFF"))
                    y += lh
            elif sh["kind"] == "ELLIPSE":
                d.ellipse(box, fill=sh.get("fill"))
            elif sh["kind"] == "ROUND":
                d.rounded_rectangle(box, radius=min(box[3] - box[1], box[2] - box[0]) * 0.18, fill=sh.get("fill"))
            else:
                d.rectangle(box, fill=sh.get("fill"))
        img.save(out / f"scene_{i:02d}.png")
    for w in warnings:
        print("AVERTISSEMENT", w)
    print(f"{len(deck['slides'])} diapositives → {out}")


if __name__ == "__main__":
    render(sys.argv[1], sys.argv[2])
