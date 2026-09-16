#!/usr/bin/env bash
# Deploy services/lantern-api to Railway from the current checkout.
#
# Why a script: `railway up` from the repo root fails with "prefix not found"
# (the CLI's uploader trips on this tree regardless of ignore files), and
# uploading the whole repo would ship node_modules, android/ and video/ as
# build context anyway. So we stage exactly what the Dockerfile COPYs into a
# scratch directory and upload that with --path-as-root.
#
#   scripts/deploy-lantern-api.sh            # deploy + wait for /healthz
#   scripts/deploy-lantern-api.sh --detach   # start the deploy and return
#
# Prereqs: `railway login` locally, or RAILWAY_TOKEN (a project token) in CI —
# a project token already pins the project, so the link step is skipped. Nothing
# here reads or prints a secret; variables live in Railway.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SERVICE=${LANTERN_API_SERVICE:-lantern-api}
# The Railway project is pinned: `railway up` from an unlinked directory
# silently creates a NEW project, so the scratch context is linked explicitly.
PROJECT=${LANTERN_RAILWAY_PROJECT:-c0d79a4d-4371-481e-aedc-43c810ba7df7}
CTX=$(mktemp -d -t lantern-api-ctx.XXXXXX)
trap 'rm -rf "$CTX"' EXIT

mkdir -p "$CTX/packages" "$CTX/services" "$CTX/src/core"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/.dockerignore" "$CTX/"
cp -r "$ROOT/packages/lantern-scanner" "$CTX/packages/"
cp -r "$ROOT/src/core/telemetry" "$CTX/src/core/"
cp -r "$ROOT/services/lantern-api" "$CTX/services/"
rm -rf "$CTX/services/lantern-api/node_modules" "$CTX/services/lantern-api/dist"

echo "context: $(du -sh "$CTX" | cut -f1) → service $SERVICE"
cd "$CTX"
if [[ -z "${RAILWAY_TOKEN:-}" ]]; then
  railway link --project "$PROJECT" --service "$SERVICE" >/dev/null
  railway status | grep -q "Project ID:.*$PROJECT" || { echo "not linked to project $PROJECT" >&2; exit 1; }
fi
if [[ "${1:-}" == "--detach" ]]; then
  railway up --service "$SERVICE" --detach --path-as-root --no-gitignore "$CTX"
  exit 0
fi
railway up --service "$SERVICE" --ci --path-as-root --no-gitignore "$CTX"

URL=${LANTERN_API_URL:-$(railway domain --service "$SERVICE" --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["domains"][0])' 2>/dev/null || echo https://lantern-api-production-3fad.up.railway.app)}
echo "waiting for $URL/healthz …"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 "$URL/healthz" 2>/dev/null; then echo; echo "deployed: $URL"; exit 0; fi
  sleep 10
done
echo "healthz did not answer in time" >&2
exit 1
