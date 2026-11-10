#!/usr/bin/env bash
set -euo pipefail
# Disposable cluster only. Does not connect to or change an existing PostgreSQL server.
pg_bin="${PG_BIN:-/opt/homebrew/opt/postgresql/bin}"
test_port="${TEST_PG_PORT:-55432}"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/student-cupboard-test.XXXXXX")"
"$pg_bin/initdb" -D "$test_dir/data" -U cupboard_test --auth=trust --no-locale --encoding=UTF8 > "$test_dir/init.log"
cleanup() { "$pg_bin/pg_ctl" -D "$test_dir/data" -m fast -w stop > /dev/null; }
"$pg_bin/pg_ctl" -D "$test_dir/data" -l "$test_dir/server.log" -o "-h 127.0.0.1 -p $test_port -k $test_dir" -w start
trap cleanup EXIT
"$pg_bin/createdb" -h 127.0.0.1 -p "$test_port" -U cupboard_test student_cupboard_test
export TEST_DATABASE_URL="postgresql://cupboard_test@127.0.0.1:$test_port/student_cupboard_test"
export REQUIRE_TEST_DATABASE=1
npm test
printf 'Stopped disposable PostgreSQL. Temporary data is at %s\n' "$test_dir"
