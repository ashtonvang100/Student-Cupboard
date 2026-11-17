#!/bin/zsh
cd "${0:A:h}"
NODE_BIN="$(command -v node)"
if [[ -z "$NODE_BIN" ]]; then NODE_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; fi
"$NODE_BIN" scripts/stop.mjs
