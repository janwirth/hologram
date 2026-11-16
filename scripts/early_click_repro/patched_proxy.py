"""Serves a Hologram app through 127.0.0.1:8899 with this branch's early-event recorder and replay
patched into the page and its runtime bundle, to run run.sh against an app that still has the
old runtime ("after" without deploying). GET only; usage: python3 -I patched_proxy.py <origin>"""

import re
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORIGIN = sys.argv[1].rstrip("/")

# lib/hologram/ui/runtime.ex: the recorder in the page's first script
RECORDER = """
globalThis.Hologram._earlyEvents = [];
globalThis.Hologram._recordEarlyEvent = function(event) {
  globalThis.Hologram._earlyEvents.push(event);
};
["click", "input", "change"].forEach(function(type) {
  document.addEventListener(type, globalThis.Hologram._recordEarlyEvent, true);
});
"""

# assets/js/hologram.mjs: Hologram.replayEarlyEvents(), called after the render's log line
REPLAY = """globalThis.__replayEarlyEvents = function() {
  const events = globalThis.Hologram?._earlyEvents;
  const recorder = globalThis.Hologram?._recordEarlyEvent;
  if (!events) return;
  ["click", "input", "change"].forEach((type) => document.removeEventListener(type, recorder, true));
  delete globalThis.Hologram._earlyEvents;
  delete globalThis.Hologram._recordEarlyEvent;
  events.forEach((event) => {
    const target = event.target;
    if (!target?.isConnected) return;
    if (event.type === "click" && target.closest?.("a[href], label, input[type=checkbox], input[type=radio]")) return;
    target.dispatchEvent(new event.constructor(event.type, event));
  });
};
"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        with urllib.request.urlopen(ORIGIN + self.path) as r:
            body, kind = r.read(), r.headers.get("content-type", "")
        if "text/html" in kind:
            body = body.decode().replace(
                "globalThis.Hologram._pendingJsInteropActions = [];",
                "globalThis.Hologram._pendingJsInteropActions = [];" + RECORDER,
                1,
            ).encode()
        elif re.search(r"/hologram/runtime-[A-Z0-9]+\.js$", self.path):
            body = (REPLAY + body.decode()).replace(
                'console.log("Hologram: page rendered in",',
                'globalThis.__replayEarlyEvents(),console.log("Hologram: page rendered in",',
                1,
            ).encode()
        self.send_response(200)
        self.send_header("content-type", kind)
        self.end_headers()
        self.wfile.write(body)


ThreadingHTTPServer(("127.0.0.1", 8899), Handler).serve_forever()
