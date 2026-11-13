#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -ne 3 ]; then
  echo 'Usage: ubuntu.sh PACKAGE SOURCE_REVISION OUTPUT' >&2
  exit 1
fi
chrome_version="$(google-chrome --version)"
node "$(dirname "$0")/../native-acceptance.mjs" --platform ubuntu-x64 --package "$1" --source-revision "$2" --chrome-version "$chrome_version" --output "$3"
