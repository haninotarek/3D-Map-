"""Minimal static server for local testing of the campus viewer (binds 0.0.0.0).
Usage: python3 serve.py [port]"""
import http.server, socketserver, sys, mimetypes, os
mimetypes.add_type('application/wasm', '.wasm'); mimetypes.add_type('model/gltf-binary', '.glb'); mimetypes.add_type('text/javascript', '.js')
os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('0.0.0.0', PORT), H) as httpd:
    print(f'Serving campus viewer on http://0.0.0.0:{PORT}', flush=True)
    httpd.serve_forever()
