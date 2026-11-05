# Student Cupboard backend

TypeScript / Node.js / Hono API with PostgreSQL and Drizzle ORM. The existing npm, Hono Node adapter, ESM configuration, and `GET /` greeting are preserved. There is no frontend in this project.

## Local setup

Requires Node.js 22 or newer, npm, and access to the **existing local** PostgreSQL database `student_cupboard`.

```sh
npm ci
cp .env.example .env # only if you do not already have .env
```

Edit `.env` with your local PostgreSQL settings. `PGUSER` defaults to the current OS username if blank. `PGPASSWORD` can be blank when your local PostgreSQL authentication permits it. Do not put credentials in source code or commit `.env`. Shell environment variables take precedence over `.env`.

```dotenv
PGHOST=localhost
PGPORT=5432
PGDATABASE=student_cupboard
PGUSER=your_local_postgres_role
PGPASSWORD=your_local_password
HOST=127.0.0.1
PORT=3000
```

Only loopback database hosts are accepted (`localhost`, `127.0.0.1`, `::1`); remote databases, including AWS RDS, are deliberately disabled pending explicit review. Local connections use no TLS. This application never creates a database. If PostgreSQL reports that `student_cupboard` does not exist, confirm the host, port, and role with the database owner instead of creating a replacement.

```sh
npm run db:check       # read-only SELECT 1
# Read drizzle/0000_initial_schema.sql and inspect existing tables first.
npm run db:migrate
npm run dev
curl http://127.0.0.1:3000/api/health
```

The API binds to loopback by default. Health returns 503 if its database query fails. Startup does not apply migrations. API reference: [docs/API.md](docs/API.md).

## Architecture

- `src/index.ts`: Node server, configuration, graceful server/pool shutdown.
- `src/app.ts`: composable Hono app, health, response headers, 64 KiB request limit, route registration.
- `src/routes/`: HTTP handling and response status codes.
- `src/validators/`: strict body, query, and path validation; unknown body and collection query fields are rejected.
- `src/services/`: business rules, queries, and atomic stock changes.
- `src/db/`: connection factory and Drizzle schema, the database source of truth.
- `src/middleware/`: consistent sanitized errors.
- `drizzle/`: generated SQL, snapshots, and migration journal (commit all three).

No authentication provider has been chosen. This is an initial development API and **must not be exposed publicly** until authentication and authorization are implemented. See the API reference for endpoint access requirements.

## Schema and stock rules

`categories` → many `products`; each product has exactly one inventory row when created through the API; products → many `inventory_transactions`. Database uniqueness enforces at most one inventory row per product. Foreign keys restrict deletion of referenced records. There are no delete or transaction-history mutation endpoints.

IDs are PostgreSQL integer identities. All timestamps are `timestamptz`, returned as ISO 8601 strings; database defaults create timestamps and Drizzle writes update timestamps. Raw SQL writers must explicitly maintain `updated_at` themselves. Categories have case-insensitive unique names. Nullable product barcodes are unique exact strings; leading zeros are retained. Nutrition uses structured JSONB with documented optional fields and API validation.

Stock is a whole number of a named unit (default `each`), from 0 through 2,147,483,647. Fractional weight/volume tracking would need an agreed precision and migration. Product creation atomically adds a zero-stock inventory row. Both stock PATCH and signed transactions lock the inventory row with `SELECT FOR UPDATE`, update quantity, and insert history in one transaction. PATCH requires a reason if quantity is supplied; a no-op quantity creates no history. Unit changes are allowed only when current stock is zero; no conversion is performed. Threshold and unit-only updates do not create quantity history. Transaction types and signs, nonnegative quantities and thresholds, unique values, and foreign keys also have database constraints.

History contains product, delta, type, reason, and time. Actor attribution awaits the authentication design; unit snapshots, lots, expiry dates, locations, and idempotency keys are future schema decisions. Use the API as the only stock writer; direct SQL can bypass service-level history creation. Before production, restrict database privileges, including UPDATE/DELETE on history, and select how to enforce audit rules for any additional writers.

## Migrations and builds

The workflow follows Drizzle's [generation and migration documentation](https://orm.drizzle.team/docs/drizzle-kit-generate). Never use schema push, reset, or drop commands against the existing database.

```sh
# After changing src/db/schema.ts:
npm run db:generate -- --name describe_your_change
# Inspect the generated SQL for data loss; arrange backups and review before applying.
npm run db:migrate

npm run typecheck      # source, tooling, and tests
npm run build          # compiles src/ into dist/
npm start              # starts compiled server; still reads .env locally
```

The initial migration is additive: it creates four tables, constraints, and indexes. The migration wrapper refuses the first migration if matching public tables already exist without the Drizzle journal. Reconcile an existing schema manually rather than overwriting it. Migration execution uses Drizzle's journal and transactions; reruns are no-ops. Run only one migration process at a time. Future generated migrations may be destructive and always need SQL review.

## Tests

The Node.js test runner and existing `tsx` are used; no additional test framework is installed.

```sh
npm test
```

Validation and HTTP error tests run without a database. PostgreSQL integration tests are **skipped** unless `TEST_DATABASE_URL` is set. To run integration tests against a separately provisioned local test database, put the URL in `.env` and run:

```dotenv
TEST_DATABASE_URL=postgresql://test_role:test_password@localhost:5432/student_cupboard_test
```

```sh
npm run test:integration
```

Integration tests reject remote hosts, URL query parameters, and any database name other than `student_cupboard_test`. They verify the actual database name before migrations, apply generated migrations, use unique fixture records, and delete only their own records in foreign-key order. They never truncate tables or reset a database. The dedicated role must be able to apply migrations and clean up its test records. Never point tests at application or production data.

Alternatively, run the entire suite against a **disposable** cluster without accessing an existing PostgreSQL server:

```sh
# macOS Homebrew PostgreSQL path is the default:
bash scripts/test-postgres.sh
# Other installations, e.g. Linux:
PG_BIN=/usr/lib/postgresql/17/bin bash scripts/test-postgres.sh
# Set TEST_PG_PORT if port 55432 is occupied.
```

This creates a temporary cluster and its own `student_cupboard_test`, binds to loopback, and stops it on exit. Temporary test data is retained at the printed path. Trust authentication is used only for this disposable loopback cluster; do not use it for application databases.

Coverage includes real connectivity, health, category/product CRUD operations supported by the API, duplicate/reference errors, inventory retrieval and audited updates, transaction creation/history, pagination, missing records, invalid bodies, constraints, overflow, rollback, and competing concurrent removals.

## Before production

- Confirm the real existing database location and schema; review and apply migrations with backups.
- Integrate the institution-approved identity system and enforce staff/manager permissions on every resource endpoint. Add authenticated actor identity to stock history and restrict history database permissions.
- Add deployment-specific HTTPS, secrets management, database TLS, a restricted database role, an approved CORS allowlist if needed, rate limiting, monitoring, and backup/restore procedures.
- Establish retry/idempotency behavior for stock-changing requests and agree on unit, expiration, and lot tracking needs.
- Review dependency advisories before CI/deployment. At implementation time, `npm audit` reported four moderate development-only findings in Drizzle Kit's `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild` chain ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)); runtime dependencies had no findings. The advisory concerns esbuild's development server, which this project does not run. No forced downgrade or transitive override was applied; review an upstream fix before introducing development-server tooling.

No AWS deployment or remote database access is configured.
