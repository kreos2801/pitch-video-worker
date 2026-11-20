#!/usr/bin/env python3
"""
Worker de rendu — Pitch vidéo programmatique (Exercice 8, Growth Hacking ESIEA)
================================================================================

Rôle : transformer un « job » préparé par la Google Sheet (script scène par scène +
diapositives PNG exportées de Google Slides) en vidéo MP4 sous-titrée, puis la
renvoyer à la web app Apps Script qui la publie sur Drive et écrit l'URL dans la Sheet.

  1. Récupère le job       GET  WEBAPP_URL?action=job&id=…&token=…
  2. Voix-off (TTS)        edge-tts (voix neuronales FR de synthèse — aucun clonage)
  3. Calibrage             durée audio ramenée dans [45 s ; 60 s] en ajustant le débit
  4. Sous-titres           bandeau incrusté, synchronisé sur les phrases (SentenceBoundary)
  5. Montage               FFmpeg : léger zoom (Ken Burns) + fondus + normalisation sonore
  6. Aperçu                GIF animé avec bouton lecture (pour l'e-mail de relance)
  7. Restitution           POST WEBAPP_URL {action:'result', mp4_b64, gif_b64, durées…}

Modes :
  python render.py --job EXE-…                 (GitHub Actions, déclenché par la Sheet)
  python render.py --poll [--interval 20]       (Colab / poste local : surveille la Sheet)
  python render.py --local job.json --out dir   (test hors ligne, sans Sheet)
  --tts mock                                    (voix factice : tests sans réseau)

Variables d'environnement : WEBAPP_URL, WORKER_TOKEN (jamais en clair dans le code).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

W, H, FPS = 1280, 720, 25
GAP = 0.35            # respiration entre deux scènes (s)
LEAD = 0.15           # silence avant la voix dans chaque scène (s)
TAIL = 1.2            # maintien de la dernière image (s)
FADE = 0.25
ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,64}$")
FALLBACK_VOICES = ["fr-FR-DeniseNeural", "fr-FR-HenriNeural", "fr-FR-EloiseNeural"]
LOGS: list[str] = []


def log(msg: str) -> None:
    line = time.strftime("%H:%M:%S ") + msg
    LOGS.append(line)
    print(line, flush=True)


def run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Commande en échec ({cmd[0]}) : {proc.stderr[-1500:]}")


def probe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nw=1:nk=1", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


# ----------------------------------------------------------------------------- API Sheet
class SheetApi:
    def __init__(self, url: str, token: str):
        if not url or not token:
            raise SystemExit("WEBAPP_URL et WORKER_TOKEN doivent être définis (secrets GitHub / variables d'env).")
        import requests  # import tardif : le mode --local n'en a pas besoin
        self.requests = requests
        self.url, self.token = url, token

    def _req(self, method: str, **kw):
        last = None
        for attempt in range(4):
            try:
                r = self.requests.request(method, self.url, timeout=300, **kw)
                data = r.json()
            except Exception as e:  # réseau, quota Apps Script, page HTML d'erreur…
                last = e
                time.sleep(3 * (attempt + 1))
                continue
            if not data.get("ok"):  # refus applicatif (jeton, ID…) : inutile de réessayer
                raise RuntimeError(f"Web app : {data.get('error', 'réponse invalide')}")
            return data
        raise RuntimeError(f"Web app injoignable : {last}")

    def get(self, action: str, **params):
        return self._req("GET", params={"action": action, "token": self.token, **params})

    def post(self, payload: dict):
        return self._req("POST", data=json.dumps({**payload, "token": self.token}),
                         headers={"Content-Type": "text/plain;charset=utf-8"})

    def status(self, job_id: str, message: str):
        try:
            self.post({"action": "status", "id": job_id, "message": message})
        except Exception as e:
            log(f"(statut non transmis : {e})")


# ----------------------------------------------------------------------------- TTS
def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?…])\s+", text.strip())
    return [p for p in parts if p]


async def _edge_tts(text: str, voice: str, rate: str, out_mp3: Path):
    import edge_tts
    comm = edge_tts.Communicate(text, voice, rate=rate)   # SentenceBoundary par défaut
    sentences = []
    with open(out_mp3, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] in ("SentenceBoundary", "WordBoundary"):
                start = chunk["offset"] / 1e7
                sentences.append((start, start + chunk["duration"] / 1e7, chunk["text"]))
    return sentences


def synth_scene(text: str, voice: str, rate_pct: int, out_mp3: Path, engine: str):
    """Retourne (durée_audio, [(début, fin, phrase)]) ; les temps sont relatifs au début de l'audio."""
    rate = f"{rate_pct:+d}%"
    if engine == "mock":
        # Voix factice (tests sans réseau) : tonalité discrète d'une durée réaliste.
        words = len([t for t in text.split() if re.search(r"\w", t)])
        dur = words / 2.5 / (1 + rate_pct / 100)
        run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"sine=frequency=180:sample_rate=24000:duration={dur:.2f}",
             "-af", "volume=0.04", "-c:a", "libmp3lame", "-b:a", "48k", str(out_mp3)])
        sents, t, total_chars = [], 0.0, max(1, len(text))
        for s in split_sentences(text):
            d = dur * len(s) / total_chars
            sents.append((t, t + d, s))
            t += d
        return probe_duration(out_mp3), sents

    last = None
    for v in [voice] + [x for x in FALLBACK_VOICES if x != voice]:
        for attempt in range(3):
            try:
                sents = asyncio.run(_edge_tts(text, v, rate, out_mp3))
                if out_mp3.stat().st_size < 2000:
                    raise RuntimeError("audio vide")
                return probe_duration(out_mp3), sents
            except Exception as e:
                last = e
                time.sleep(2 * (attempt + 1))
        log(f"Voix {v} indisponible ({last}) → voix suivante")
    raise RuntimeError(f"Synthèse vocale impossible : {last}")


def synthesize_all(job: dict, work: Path, engine: str):
    """Synthétise toutes les scènes et calibre le débit pour viser 45-60 s d'audio."""
    scenes = job["scenes"]
    n = len(scenes)
    tmin = float(job.get("target_seconds", {}).get("min", 45))
    tmax = float(job.get("target_seconds", {}).get("max", 60))
    # La vidéo ajoute des respirations : on vise un audio qui laisse la vidéo ≤ tmax.
    audio_max = max(tmin + 5, tmax - (n * (GAP + LEAD) + TAIL))
    rate = 0
    results = []
    for attempt in range(3):
        results = []
        for sc in scenes:
            mp3 = work / f"voice_{sc['scene_id']:02d}.mp3"
            results.append(synth_scene(sc["texte_voix_off"], job["voice"], rate, mp3, engine))
        total = sum(d for d, _ in results)
        log(f"TTS débit {rate:+d}% → audio {total:.1f} s (cible {tmin:.0f}-{audio_max:.0f} s)")
        if tmin <= total <= audio_max:
            break
        if total > audio_max:
            new_rate = min(30, rate + math.ceil((total / audio_max - 1) * 100) + 2)
        else:
            new_rate = max(-15, rate - math.ceil((1 - total / tmin) * 100) - 1)
        if new_rate == rate:
            break
        rate = new_rate
    return results, rate


# ----------------------------------------------------------------------------- sous-titres
WEAK_END = {"de", "du", "des", "la", "le", "les", "un", "une", "à", "au", "aux", "et", "pour", "en",
            "par", "sur", "dans", "avec", "mon", "ma", "mes", "vos", "votre", "nos", "notre", "ce", "cette", "qui", "que", "a", "est", "ont"}


def chunk_sentence(sentence: str, max_chars: int = 40) -> list[str]:
    """Découpe une phrase en sous-titres lisibles (≤ ~40 caractères), sans finir sur « de », « la »…"""
    words, chunks, cur = sentence.split(), [], ""
    for w in words:
        cand = (cur + " " + w).strip()
        if len(cand) > max_chars and cur:
            head, _, last = cur.rpartition(" ")
            if head and last.lower().strip("'’") in WEAK_END:   # le mot faible passe à la ligne suivante
                chunks.append(head)
                cur = last + " " + w
            else:
                chunks.append(cur)
                cur = w
        else:
            cur = cand
        if re.search(r"[,;:]$", w) and len(cur) >= 22:
            chunks.append(cur)
            cur = ""
    if cur:
        chunks.append(cur)
    # évite un dernier morceau orphelin d'un seul mot
    if len(chunks) > 1 and len(chunks[-1].split()) == 1:
        last = chunks.pop()
        chunks[-1] += " " + last
    return chunks


def build_cues(text: str, sentences: list, duration: float) -> list[tuple[float, float, str]]:
    if not sentences:
        sentences = [(0.0, duration, text)]
    cues = []
    for (s, e, st) in sentences:
        parts = chunk_sentence(st)
        total = sum(len(p) for p in parts) or 1
        t = s
        for p in parts:
            d = (e - s) * len(p) / total
            cues.append([t, t + d, p])
            t += d
    for i in range(len(cues) - 1):          # pas de « trou » entre deux sous-titres
        cues[i][1] = cues[i + 1][0]
    if cues:
        cues[-1][1] = max(cues[-1][1], duration) + GAP * 0.6
    return [tuple(c) for c in cues]


def load_font(size: int):
    from PIL import ImageFont
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
              "/Library/Fonts/Arial Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default(size=size)


def wrap(draw, text: str, font, max_w: int) -> list[str]:
    lines, cur = [], ""
    for w in text.split():
        cand = (cur + " " + w).strip()
        if draw.textlength(cand, font=font) <= max_w or not cur:
            cur = cand
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines[:2]


def render_cue_png(text: str, out: Path, font) -> None:
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lines = wrap(d, text, font, 1060)
    lh = font.size + 10
    tw = max(d.textlength(l, font=font) for l in lines)
    bw, bh = tw + 48, lh * len(lines) + 22
    x0, y1 = (W - bw) / 2, H - 34
    y0 = y1 - bh
    d.rounded_rectangle([x0, y0, x0 + bw, y1], radius=14, fill=(0, 0, 0, 178))
    for i, l in enumerate(lines):
        lw = d.textlength(l, font=font)
        d.text(((W - lw) / 2, y0 + 11 + i * lh), l, font=font, fill=(255, 255, 255, 255))
    img.save(out)


def render_badge_png(text: str, out: Path, n_scenes: int) -> None:
    """Mention « voix de synthèse » (transparence IA), placée à gauche des pastilles de progression."""
    from PIL import Image, ImageDraw
    font = load_font(15)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    tw = d.textlength(text, font=font)
    k = W / 720                                   # points Slides → pixels
    x1, y0 = (720 - 36 - n_scenes * 14) * k - 16, 26 * k - 14
    d.rounded_rectangle([x1 - tw - 22, y0, x1, y0 + 28], radius=12, fill=(0, 0, 0, 120))
    d.text((x1 - tw - 11, y0 + 5), text, font=font, fill=(255, 255, 255, 215))
    img.save(out)


def render_play_png(out: Path) -> None:
    from PIL import Image, ImageDraw
    s = 160
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([4, 4, s - 4, s - 4], fill=(0, 0, 0, 150), outline=(255, 255, 255, 230), width=6)
    d.polygon([(s * 0.40, s * 0.30), (s * 0.40, s * 0.70), (s * 0.72, s * 0.50)], fill=(255, 255, 255, 240))
    img.save(out)


# ----------------------------------------------------------------------------- montage
def render_scene(slide_png: Path, mp3: Path, audio_dur: float, cues, badge: Path, out: Path,
                 hold: float, bg: str, work: Path, font) -> float:
    dur = LEAD + audio_dur + GAP + hold
    frames = math.ceil(dur * FPS)
    inputs = ["-i", str(slide_png), "-i", str(mp3), "-loop", "1", "-i", str(badge)]
    cue_files = []
    for k, (s, e, txt) in enumerate(cues):
        p = work / f"{out.stem}_cue{k:02d}.png"
        render_cue_png(txt, p, font)
        cue_files.append((p, s + LEAD, min(e + LEAD, dur)))
        inputs += ["-loop", "1", "-i", str(p)]

    bgc = bg.lstrip("#")
    f = [f"[0:v]scale=2560:1440:force_original_aspect_ratio=decrease,"
         f"pad=2560:1440:(ow-iw)/2:(oh-ih)/2:color=0x{bgc},setsar=1,"
         f"zoompan=z='min(1+0.0004*on,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
         f"d={frames}:s={W}x{H}:fps={FPS}[base]",
         "[base][2:v]overlay=0:0:shortest=0[v0]"]
    last = "v0"
    for k, (_, s, e) in enumerate(cue_files):
        f.append(f"[{last}][{k + 3}:v]overlay=0:0:enable='between(t,{s:.3f},{e:.3f})'[v{k + 1}]")
        last = f"v{k + 1}"
    f.append(f"[{last}]fade=t=in:st=0:d={FADE},fade=t=out:st={dur - FADE:.3f}:d={FADE},format=yuv420p[v]")
    f.append(f"[1:a]aresample=44100,adelay={int(LEAD * 1000)}:all=1,apad[a]")

    run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(f), "-map", "[v]", "-map", "[a]",
         "-t", f"{dur:.3f}", "-r", str(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
         "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2", str(out)])
    return dur


def render_job(job: dict, work: Path, engine: str, status=lambda m: None) -> dict:
    scenes = job["scenes"]
    if not 1 <= len(scenes) <= 10:
        raise ValueError("Nombre de scènes invalide")
    bg = job.get("theme", {}).get("bg", "#000000")

    # Diapositives
    for sc in scenes:
        p = work / f"slide_{sc['scene_id']:02d}.png"
        if sc.get("slide_png_b64"):
            p.write_bytes(base64.b64decode(sc["slide_png_b64"]))
        elif sc.get("slide_path"):
            shutil.copy(sc["slide_path"], p)
        else:
            raise ValueError(f"Scène {sc['scene_id']} : diapositive manquante")
        sc["_slide"] = p

    status("TTS (voix de synthèse) en cours")
    results, rate = synthesize_all(job, work, engine)
    audio_total = sum(d for d, _ in results)

    # Si l'audio reste court (< min), on prolonge l'affichage pour atteindre la durée vidéo minimale.
    tmin = float(job.get("target_seconds", {}).get("min", 45))
    base_video = audio_total + len(scenes) * (LEAD + GAP) + TAIL
    extra = max(0.0, tmin - base_video) / len(scenes)

    status("Montage vidéo (FFmpeg)")
    font = load_font(34)
    badge = work / "badge.png"
    render_badge_png(job.get("disclosure", "Voix de synthèse"), badge, len(scenes))
    clips, video_total = [], 0.0
    for i, (sc, (dur, sents)) in enumerate(zip(scenes, results)):
        cues = build_cues(sc["texte_voix_off"], sents, dur)
        clip = work / f"scene_{sc['scene_id']:02d}.mp4"
        hold = extra + (TAIL if i == len(scenes) - 1 else 0.0)
        video_total += render_scene(sc["_slide"], work / f"voice_{sc['scene_id']:02d}.mp3", dur, cues,
                                    badge, clip, hold, bg, work, font)
        clips.append(clip)
        log(f"Scène {sc['scene_id']} ({sc.get('type', '')}) : audio {dur:.1f} s, {len(cues)} sous-titres")

    listing = work / "concat.txt"
    listing.write_text("".join(f"file '{c.name}'\n" for c in clips))
    final = work / "final.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c:v", "copy",
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
         "-movflags", "+faststart", str(final)])

    status("Génération de l'aperçu GIF")
    play = work / "play.png"
    render_play_png(play)
    gif = work / "preview.gif"
    run(["ffmpeg", "-y", "-ss", "0.4", "-t", "4", "-i", str(final), "-i", str(play), "-filter_complex",
         "[0:v]fps=10,scale=480:-1:flags=lanczos[s];[1:v]scale=76:76[p];"
         "[s][p]overlay=(W-w)/2:(H-h)/2-10,split[a][b];[a]palettegen=max_colors=96[pal];"
         "[b][pal]paletteuse=dither=bayer:bayer_scale=4", "-loop", "0", str(gif)])

    real_video = probe_duration(final)
    log(f"Vidéo finale : {real_video:.1f} s (audio {audio_total:.1f} s), "
        f"{final.stat().st_size / 1e6:.2f} Mo, GIF {gif.stat().st_size / 1e6:.2f} Mo")
    if not 45 <= audio_total <= 60:
        log(f"AVERTISSEMENT : audio hors cible ({audio_total:.1f} s)")
    return {"mp4": final, "gif": gif, "audio_seconds": round(audio_total, 2),
            "video_seconds": round(real_video, 2), "rate": f"{rate:+d}%", "voice": job["voice"]}


# ----------------------------------------------------------------------------- orchestration
def process_remote(api: SheetApi, job_id: str, engine: str) -> None:
    if not ID_RE.match(job_id):
        raise SystemExit("ID de job invalide")
    LOGS.clear()
    log(f"Job {job_id} : récupération")
    api.status(job_id, "Worker démarré")
    try:
        job = api.get("job", id=job_id)["job"]
        with tempfile.TemporaryDirectory() as tmp:
            out = render_job(job, Path(tmp), engine, status=lambda m: api.status(job_id, m))
            api.status(job_id, "Envoi de la vidéo vers Drive")
            res = api.post({
                "action": "result", "id": job_id,
                "mp4_b64": base64.b64encode(out["mp4"].read_bytes()).decode(),
                "gif_b64": base64.b64encode(out["gif"].read_bytes()).decode(),
                "audio_seconds": out["audio_seconds"], "video_seconds": out["video_seconds"],
                "voice": out["voice"], "rate": out["rate"], "logs": " | ".join(LOGS[-12:]),
            })
            log(f"Publié : {res.get('video_url')}")
    except Exception as e:
        log(f"ERREUR : {e}")
        try:
            api.post({"action": "error", "id": job_id, "message": str(e)[:500], "logs": " | ".join(LOGS[-12:])})
        except Exception as e2:
            log(f"(erreur non transmise à la Sheet : {e2})")
        raise


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--job", help="ID_Execution à rendre (mode GitHub Actions)")
    ap.add_argument("--poll", action="store_true", help="surveille la Sheet et rend les jobs en attente")
    ap.add_argument("--interval", type=int, default=20)
    ap.add_argument("--once", action="store_true", help="avec --poll : s'arrête après un passage")
    ap.add_argument("--local", help="job.json local (test sans Sheet)")
    ap.add_argument("--out", default="out", help="dossier de sortie du mode --local")
    ap.add_argument("--tts", choices=["edge", "mock"], default="edge")
    a = ap.parse_args()

    if shutil.which("ffmpeg") is None:
        raise SystemExit("FFmpeg introuvable (apt install ffmpeg)")

    if a.local:
        job = json.loads(Path(a.local).read_text(encoding="utf-8"))
        base = Path(a.local).parent
        for sc in job["scenes"]:
            if sc.get("slide_path") and not os.path.isabs(sc["slide_path"]):
                sc["slide_path"] = str(base / sc["slide_path"])
        outdir = Path(a.out)
        outdir.mkdir(parents=True, exist_ok=True)
        work = outdir / "_work"
        work.mkdir(exist_ok=True)
        res = render_job(job, work, a.tts, status=lambda m: log("statut : " + m))
        shutil.copy(res["mp4"], outdir / f"pitch_{job['id']}.mp4")
        shutil.copy(res["gif"], outdir / f"apercu_{job['id']}.gif")
        print(json.dumps({k: (str(v) if isinstance(v, Path) else v) for k, v in res.items()}, ensure_ascii=False, indent=1))
        return

    api = SheetApi(os.environ.get("WEBAPP_URL", ""), os.environ.get("WORKER_TOKEN", ""))
    if a.job:
        process_remote(api, a.job, a.tts)
    elif a.poll:
        log("Mode polling : en attente de jobs (Ctrl+C pour arrêter)")
        tried: set[str] = set()
        while True:
            nxt = api.get("next").get("id")
            if nxt and nxt not in tried:
                tried.add(nxt)
                try:
                    process_remote(api, nxt, a.tts)
                except Exception as e:
                    log(f"Job {nxt} en échec : {e}")
                continue                      # on regarde tout de suite s'il reste des jobs
            if a.once:
                break
            time.sleep(a.interval)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
