#!/usr/bin/env python3
"""Local dev server that disables caching entirely.

Plain `python3 -m http.server` sends no Cache-Control headers, which lets
Chrome silently reuse old cached copies of the ES module files (physics.mjs,
input.js, ...) after a `git pull` -- main.js then fails to import a newly
added export from the stale cached module and the whole page breaks with no
visible error (blank canvas, dead buttons), because the browser never even
asked the server for the new file. Use this instead of http.server while
iterating so every reload always gets the current files on disk.
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    HTTPServer(('', port), NoCacheHandler).serve_forever()
