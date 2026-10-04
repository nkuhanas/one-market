#!/usr/bin/env bash
# Shared setup; executable entrypoints source this file.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LOCAL_UID="${LOCAL_UID:-$(id -u)}"
export LOCAL_GID="${LOCAL_GID:-$(id -g)}"

compose() {
  docker compose --project-directory "$REPO_ROOT" -f "$REPO_ROOT/infra/docker-compose.yml" "$@"
}

database_name() {
  # Compose resolves shell overrides and the root .env without sourcing arbitrary code.
  compose --profile tools config --format json | docker run --rm -i node:24.21.0-bookworm-slim \
    node -e 'let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).services.tools.environment.SPACETIMEDB_DATABASE));'
}
