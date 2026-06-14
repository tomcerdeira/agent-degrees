#!/usr/bin/env sh
set -eu

if [ -z "${AGENT_DEGREES_HOME:-}" ]; then
  echo "AGENT_DEGREES_HOME is not set. Point it at your agent-degrees repo." >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  echo "Usage: degree.sh \"task text\" [--file path] [--command cmd]" >&2
  exit 1
fi

task="$1"
shift

npm --prefix "$AGENT_DEGREES_HOME" run resolve -- --task "$task" "$@"
