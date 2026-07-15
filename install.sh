#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
plugin_source="${script_dir}/better-atlassian.ts"
plugin_destination="${HOME}/.config/amp/plugins/better-atlassian.ts"
skill_source="${script_dir}/.skills/using-jira/SKILL.md"
skill_destination="${HOME}/.config/agents/skills/using-jira/SKILL.md"

if [[ ! -f "${plugin_source}" ]]; then
  echo "Plugin source not found: ${plugin_source}" >&2
  exit 1
fi

if [[ ! -f "${skill_source}" ]]; then
  echo "Skill source not found: ${skill_source}" >&2
  exit 1
fi

mkdir -p -- "$(dirname -- "${plugin_destination}")"
install -m 0644 "${plugin_source}" "${plugin_destination}"

mkdir -p -- "$(dirname -- "${skill_destination}")"
install -m 0644 "${skill_source}" "${skill_destination}"

echo "Installed Atlassian plugin to ${plugin_destination}"
echo "Installed Jira skill to ${skill_destination}"
echo "Run 'plugins: reload' in Amp to load it."
