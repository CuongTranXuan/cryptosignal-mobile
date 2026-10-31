#!/bin/bash
# Mac: OmniRoute headless, no CLI supervisor. Needs Node 22 (nvm) + npm i -g omniroute@3.8.52
set -a; [ -f "$HOME/.omniroute/.env" ] && . "$HOME/.omniroute/.env"; set +a
OMR="$(npm root -g)/omniroute/dist"; cd "$OMR" || exit 1
export NODE_ENV=production DATA_DIR="${DATA_DIR:-$HOME/.omniroute}" HOSTNAME=127.0.0.1 OMNIROUTE_SERVER_HOST=127.0.0.1
export PORT=20128 OMNIROUTE_PORT=20128 API_PORT=20128 DASHBOARD_PORT=20128
export OMNIROUTE_HEADLESS=1 OMNIROUTE_DISABLE_BACKGROUND_SERVICES=true OMNIROUTE_MEMORY_MB=512
export CALL_LOG_RETENTION_DAYS=3 CALL_LOG_MAX_ENTRIES=2000 MAX_PENDING_REQUEST_AGE_MS=600000
exec node --dns-result-order=ipv4first --max-old-space-size=512 --max-semi-space-size=2 server-ws.mjs
