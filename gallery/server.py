"""Meme Factory gallery: a local page for reviewing, approving and posting memes.

The mod starts this with $.process.spawn and owns its lifetime: the process dies
when the session or the mod unloads. Standard library only.

  stdin   <token>                  the session's random token, one line
  stdout  READY <port>             once listening
          EVENT <json>             one line per action taken on the page
  POST /api/state                  the mod pushes the current state (token header)
  GET  /api/state?since=<version>  the page long-polls for a newer state
  POST /api/event                  the page reports an action
"""

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# The token arrives on stdin, not argv, so other local processes can't read it from ps.
TOKEN = sys.stdin.readline().strip()
PAGE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index.html'), 'rb').read()
MAX_BODY = 256 * 1024
EVENT_TYPES = {'select', 'approve', 'feedback', 'remix', 'new', 'post', 'settings', 'back'}

state = {'version': 0, 'body': {}}
changed = threading.Condition()
out_lock = threading.Lock()


def emit(line):
    with out_lock:
        sys.stdout.write(line + '\n')
        sys.stdout.flush()


class Handler(BaseHTTPRequestHandler):
    server_version = 'MemeFactory/1'

    def log_message(self, *args):
        pass  # stdout is the mod's channel; keep it clean

    def _send(self, code, body=b'', kind='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if kind.startswith('text/html'):
            self.send_header(
                'Content-Security-Policy',
                "default-src 'self'; img-src 'self' https://api.memegen.link data:; "
                "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
            )
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _trusted(self):
        # Only this loopback origin, with this session's token: no other site or process can drive it.
        port = self.server.server_address[1]
        if self.headers.get('Host') not in (f'127.0.0.1:{port}', f'localhost:{port}'):
            return False
        origin = self.headers.get('Origin')
        if origin and origin not in (f'http://127.0.0.1:{port}', f'http://localhost:{port}'):
            return False
        return bool(TOKEN) and self.headers.get('X-Meme-Token') == TOKEN

    def _json_body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError('bad length')
        return json.loads(self.rfile.read(length))

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/':
            port = self.server.server_address[1]
            if self.headers.get('Host') not in (f'127.0.0.1:{port}', f'localhost:{port}'):
                return self._send(403)
            return self._send(200, PAGE, 'text/html; charset=utf-8')
        if url.path == '/api/state':
            if not self._trusted():
                return self._send(403)
            since = int((parse_qs(url.query).get('since') or ['-1'])[0])
            with changed:
                changed.wait_for(lambda: state['version'] != since, timeout=25)
                payload = json.dumps({'version': state['version'], **state['body']}).encode()
            return self._send(200, payload)
        self._send(404)

    def do_POST(self):
        if not self._trusted():
            return self._send(403)
        try:
            body = self._json_body()
        except Exception:
            return self._send(400)
        url = urlparse(self.path)
        if url.path == '/api/state':
            with changed:
                state['version'] += 1
                state['body'] = body if isinstance(body, dict) else {}
                changed.notify_all()
            return self._send(204)
        if url.path == '/api/event':
            if not isinstance(body, dict) or body.get('type') not in EVENT_TYPES:
                return self._send(400)
            emit('EVENT ' + json.dumps(body, separators=(',', ':')))
            return self._send(204)
        self._send(404)


def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    emit(f'READY {server.server_address[1]}')
    server.serve_forever()


if __name__ == '__main__':
    main()
