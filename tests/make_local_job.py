#!/usr/bin/env python3
"""Construit un job.json local (même contrat que buildManifest_) à partir d'un script fixture
et des diapositives rendues par render_mock_slides.py. Usage :
python3 tests/make_local_job.py B tests/fixtures/script_B.json tests/out/slides_B tests/out/job_B.json"""
import json
import sys
from pathlib import Path

THEMES = {"A": {"accent": "#22D3EE", "bg": "#0B1F3A", "text": "#FFFFFF"},
          "B": {"accent": "#FF6B35", "bg": "#121212", "text": "#FFFFFF"}}
VOICES = {"A": "fr-FR-HenriNeural", "B": "fr-FR-DeniseNeural"}

opt, script_path, slides_dir, out = sys.argv[1:5]
script = json.loads(Path(script_path).read_text())
out = Path(out)
job = {
    "schema": "pitch-video/1", "id": f"EXE-LOCAL-{opt}", "option": opt, "titre_video": script["titre_video"],
    "voice": VOICES[opt], "target_seconds": {"min": 45, "max": 60}, "disclosure": "Voix de synthèse",
    "theme": THEMES[opt],
    "scenes": [{
        "scene_id": i + 1, "type": sc["type"], "titre_ecran": sc["titre_ecran"],
        "mots_cles_ecran": sc["mots_cles_ecran"], "texte_voix_off": sc["texte_voix_off"],
        "slide_path": str(Path(slides_dir).resolve() / f"scene_{i + 1:02d}.png"),
    } for i, sc in enumerate(script["scenes"])],
}
out.write_text(json.dumps(job, ensure_ascii=False, indent=1))
print("job →", out)
