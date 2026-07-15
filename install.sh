#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source_file="${script_dir}/better-atlassian.ts"
destination="${HOME}/.config/amp/plugins/better-atlassian.ts"

if [[ ! -f "${source_file}" ]]; then
  echo "Plugin source not found: ${source_file}" >&2
  exit 1
fi

mkdir -p -- "$(dirname -- "${destination}")"
install -m 0644 "${source_file}" "${destination}"

echo "Installed Atlassian plugin to ${destination}"
echo "Run 'plugins: reload' in Amp to load it."
