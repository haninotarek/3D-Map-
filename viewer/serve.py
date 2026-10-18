"""Static server for the campus viewer + local Arabic TTS bridge (espeak-ng).
Usage: python3 serve.py [port]  — /tts?text=... returns real Arabic audio/wav."""
import http.server, socketserver, sys, mimetypes, os, urllib.parse, subprocess, tempfile

mimetypes.add_type('application/wasm', '.wasm'); mimetypes.add_type('model/gltf-binary', '.glb'); mimetypes.add_type('text/javascript', '.js')
os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
TTS_VOICE = os.environ.get('TTS_VOICE', 'ar'); TTS_RATE = os.environ.get('TTS_RATE', '135')

def tts_wav(text):
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f: out = f.name
    try:
        subprocess.run(['espeak-ng', '-v', TTS_VOICE, '-s', TTS_RATE, '-w', out, text], check=True, capture_output=True, timeout=10)
        return open(out, 'rb').read()
    finally:
        try: os.unlink(out)
        except OSError: pass

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); super().end_headers()
    def do_GET(self):
        q = urllib.parse.urlparse(self.path)
        if q.path == '/tts':
            text = (urllib.parse.parse_qs(q.query).get('text', [''])[0] or '').strip()
            if not text: self.send_error(400, 'text required'); return
            try: data = tts_wav(text)
            except Exception as e: self.send_error(500, str(e)); return
            self.send_response(200); self.send_header('Content-Type', 'audio/wav')
            self.send_header('Content-Length', str(len(data))); self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'max-age=3600'); self.end_headers(); self.wfile.write(data); return
        super().do_GET()
    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('0.0.0.0', PORT), H) as httpd:
    print(f'Serving campus viewer + Arabic TTS on http://0.0.0.0:{PORT}', flush=True)
    httpd.serve_forever()
