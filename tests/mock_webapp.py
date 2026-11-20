#!/usr/bin/env python3
"""
Doublure de la web app Apps Script (même contrat que 07_WebApp.gs) pour tester le worker
de bout en bout sans Google : GET job / next, POST status / result / error.
Usage : python3 tests/mock_webapp.py tests/out/job_B.json 8765   (puis lancer le worker)
"""
import base64
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

JOB = json.loads(Path(sys.argv[1]).read_text())
for sc in JOB["scenes"]:
    sc["slide_png_b64"] = base64.b64encode(Path(sc.pop("slide_path")).read_bytes()).decode()
TOKEN = "test-token"
STATE = {"status": "4_RENDU_EN_ATTENTE"}
OUT = Path(sys.argv[1]).parent / "mock_webapp_result"


class H(BaseHTTPRequestHandler):
    def _send(self, obj):
        b = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *a):
        pass

    def do_GET(self):
        q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        if q.get("token") != TOKEN:
            return self._send({"ok": False, "error": "Non autorisé"})
        if q.get("action") == "next":
            return self._send({"ok": True, "id": JOB["id"] if STATE["status"] == "4_RENDU_EN_ATTENTE" else None})
        if q.get("action") == "job" and q.get("id") == JOB["id"]:
            STATE["status"] = "4_RENDU_EN_COURS"
            return self._send({"ok": True, "job": JOB})
        self._send({"ok": False, "error": "Action inconnue"})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if body.get("token") != TOKEN:
            return self._send({"ok": False, "error": "Non autorisé"})
        print("POST", body["action"], body.get("message", ""), flush=True)
        if body["action"] == "result":
            OUT.mkdir(exist_ok=True)
            (OUT / "video.mp4").write_bytes(base64.b64decode(body["mp4_b64"]))
            (OUT / "apercu.gif").write_bytes(base64.b64decode(body["gif_b64"]))
            STATE.update(status="TERMINE", audio=body["audio_seconds"], video=body["video_seconds"])
            print("RESULT", {k: v for k, v in body.items() if not k.endswith("_b64") and k != "token"}, flush=True)
            return self._send({"ok": True, "video_url": "https://drive.google.com/file/d/MOCK/view"})
        if body["action"] == "error":
            STATE["status"] = "ERREUR"
        self._send({"ok": True})


HTTPServer(("127.0.0.1", int(sys.argv[2])), H).serve_forever()
