# Clicks and input before the first render are lost

The server's HTML looks finished, but it has no listeners until the runtime and the page bundle
have loaded and the first render has run. Anything the user does in that time (a click on a
button, a keystroke in a field) reaches nothing and is dropped silently. On a page with a large
bundle that window is seconds long on a slow connection; buttons look dead and users report
"the dropdown doesn't open" or "I can't add a person" with no error anywhere.

## Repro (Lightpanda)

`sh run.sh https://<app>/hologram/counter-test` clicks the counter's "+1" at DOMContentLoaded,
before the first render, and prints the count 3 s later:

- before the fix: `count after an early click: "0"`
- after the fix: `count after an early click: "1"`

`patched_proxy.py <origin>` serves an app through 127.0.0.1:8899 with the fix patched into the
page and its runtime bundle, to see the "after" without deploying.

## Fix (janwirth/hologram@142e4c0)

The page's first script (`Hologram.UI.Runtime`) records `click`, `input` and `change` events in
the capture phase; after its first render the runtime dispatches each again on its element
(`Hologram.replayEarlyEvents`), once, and removes the recorder. Elements the render removed are
skipped, and so are clicks the browser already acted on (links, labels, checkboxes, radios),
which their `change` event carries. Prior art: Angular's `withEventReplay()` (JSAction).
