#!/bin/sh
# Lightpanda repro of a click lost before the runtime renders: opens a page with the counter of
# a counter-test page (a #count and a "+1" button, count 0), clicks +1 before the runtime has
# rendered, and prints the count. Lost click: 0. Replayed click: 1.
#   sh run.sh https://dev.example.com/hologram/counter-test
url="$1"
dir=$(dirname "$0")
lightpanda=${LIGHTPANDA:-lightpanda}
"$lightpanda" fetch --log-level fatal --wait-ms 20000 \
  --inject-script "$(cat "$dir/early_click.js")" \
  --wait-script "window.__count !== undefined && (document.body.setAttribute('data-count', window.__count), true)" \
  --dump html "$url" | grep -o 'data-count="[^"]*"' | sed 's/data-count=/count after an early click: /'
