"""Tests unitaires du worker (python3 -m unittest tests/test_worker.py) — sans réseau."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "worker"))
import render  # noqa: E402


class TestSubtitles(unittest.TestCase):
    def test_chunks_are_short_and_never_end_on_weak_word(self):
        s = ("Pendant mon stage de fin d'études en cabinet de conseil, j'ai conduit 12 entretiens métiers "
             "pour une analyse de risques EBIOS RM et cartographié 40 actifs essentiels.")
        chunks = render.chunk_sentence(s)
        self.assertEqual(" ".join(chunks), s)                       # aucun mot perdu
        for c in chunks[:-1]:
            self.assertLessEqual(len(c), 44)
            self.assertNotIn(c.split()[-1].lower(), render.WEAK_END)

    def test_cues_cover_the_whole_scene_without_gaps(self):
        sents = [(0.0, 3.0, "Bonjour ! Je suis Camille."), (3.2, 7.5, "Je candidate au poste de consultante GRC junior.")]
        cues = render.build_cues("", sents, 7.6)
        for a, b in zip(cues, cues[1:]):
            self.assertAlmostEqual(a[1], b[0])                      # pas de trou entre sous-titres
        self.assertGreaterEqual(cues[-1][1], 7.6)


class TestCalibration(unittest.TestCase):
    def _job(self, words_per_scene):
        txt = " ".join(["mot"] * words_per_scene) + "."
        return {"voice": "x", "target_seconds": {"min": 45, "max": 60},
                "scenes": [{"scene_id": i, "texte_voix_off": txt} for i in range(1, 6)]}

    def test_long_script_is_sped_up(self):
        with tempfile.TemporaryDirectory() as d:
            res, rate = render.synthesize_all(self._job(30), Path(d), "mock")   # 150 mots ≈ 60 s
        self.assertGreater(rate, 0)
        self.assertLessEqual(sum(x for x, _ in res), 57)

    def test_short_script_is_slowed_down(self):
        with tempfile.TemporaryDirectory() as d:
            res, rate = render.synthesize_all(self._job(21), Path(d), "mock")   # 105 mots ≈ 42 s
        self.assertLess(rate, 0)
        self.assertGreaterEqual(sum(x for x, _ in res), 45)


if __name__ == "__main__":
    unittest.main()
