#!/usr/bin/env bash
cd /home/sprite/work/blud || exit 1
set -o pipefail
run() {
  name="$1"; shift
  echo ""
  echo "===== $name ====="
  "$@" 2>&1 | tail -35
  echo "EXIT_$name=$?"
}
run lint_app pnpm run lint:app
run types_check pnpm run types:check:app
run test_app pnpm run test:app
run format_check pnpm run format:check
run knip pnpm run knip
echo ""
echo "===== build_app ====="
SKIP_ENV_VALIDATION=true pnpm run build:app 2>&1 | tail -45
echo "EXIT_build_app=$?"
