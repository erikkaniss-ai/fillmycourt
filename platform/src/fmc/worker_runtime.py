"""Worker process with a private HTTP liveness/readiness surface."""
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from sqlalchemy import text
from .jobs import Projector, Worker


def run(db, service):
    allowed = {'reconciliation-worker': {'reconcile'}, 'provider-sync-worker': {'sync_bookings', 'sync_players', 'sync_payments'}}
    worker = Worker(db, kinds=allowed[service])
    projector = Projector(db) if service == 'reconciliation-worker' else None

    class Health(BaseHTTPRequestHandler):
        def log_message(self, *_):
            return
        def do_GET(self):
            if self.path == '/health/live':
                self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
            elif self.path == '/health/ready':
                try:
                    with db.read() as connection:
                        connection.execute(text('SELECT 1'))
                    self.send_response(200); self.end_headers(); self.wfile.write(b'{"ok":true}')
                except Exception:
                    self.send_response(503); self.end_headers(); self.wfile.write(b'{"ok":false}')
            else:
                self.send_response(404); self.end_headers()

    server = ThreadingHTTPServer(('0.0.0.0', int(os.getenv('PORT', '8000'))), Health)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        while True:
            worked = worker.step()
            if projector:
                projector.step()
            if not worked:
                time.sleep(1)
    finally:
        server.shutdown()
