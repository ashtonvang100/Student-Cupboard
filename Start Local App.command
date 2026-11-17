#!/bin/zsh
cd "${0:A:h}"
NODE_BIN="$(command -v node)"
if [[ -z "$NODE_BIN" ]]; then NODE_BIN="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; fi
export PATH="${NODE_BIN:h}:$PATH"
"$NODE_BIN" scripts/dev.mjs
