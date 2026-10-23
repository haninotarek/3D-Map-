#!/usr/bin/env python3
"""Serve the web viewer over HTTP/1.1 with clean audio range/keepalive support & espeak-ng fallback.
Usage: python3 serve.py [port]   (default: 8080)"""
import os
import shutil
import subprocess
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))
ESPEAK = shutil.which("espeak-ng") or shutil.which("espeak")


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/__tts"):
            if not ESPEAK:
                self.send_error(404)
                return
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            text = (q.get("text", [""])[0])[:400]
            lang = "ar" if q.get("lang", ["ar"])[0].startswith("ar") else "en"
            if not text:
                self.send_error(400)
                return
            wav = subprocess.run([ESPEAK, "-v", lang, "-s", "145", "--stdout", text],
                                 capture_output=True, timeout=15).stdout
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav)))
            self.end_headers()
            try:
                self.wfile.write(wav)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError):
            pass


print(f"Serving {os.getcwd()} at http://0.0.0.0:{port}/ (HTTP/1.1, tts fallback: {bool(ESPEAK)})")
ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
