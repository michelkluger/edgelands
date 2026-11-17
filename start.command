#!/bin/sh
# macOS double-click launcher (Finder runs .command files in Terminal).
exec sh "$(dirname "$0")/start.sh"
