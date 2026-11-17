#!/bin/sh
# macOS and Linux: start Edgelands and open it in the browser (macOS: double-click start.command).
cd "$(dirname "$0")" || exit 1
if ! command -v bun >/dev/null 2>&1 && [ -x "$HOME/.bun/bin/bun" ]; then PATH="$HOME/.bun/bin:$PATH"; fi
if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is not installed. Install it with:  curl -fsSL https://bun.sh/install | bash   then run this again."
  exit 1
fi
exec bun start
