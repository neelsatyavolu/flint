"""S6 helper: serves /start which 302s to http://<host>:<port>/auth/callback?code=fake&state=s (stands in for the identity provider)."""
import http.server, urllib.parse
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        host, port = q.get("host", ["localhost"])[0], q.get("port", ["1455"])[0]
        self.send_response(302); self.send_header("Location", f"http://{host}:{port}/auth/callback?code=fake&state=s"); self.end_headers()
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", 8099), H).serve_forever()
