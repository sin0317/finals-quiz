#!/bin/sh
set -eu

# server.js 顶部 loadDotEnv() 会自动加载同目录的 .env
cd "$(dirname "$0")"

# PORT 由 runtime 设，兜底 8000
export PORT="${PORT:-8000}"

exec node server.js
