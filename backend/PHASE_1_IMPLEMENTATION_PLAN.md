# Student Cupboard Phase 1 Implementation Plan

## 1. Executive summary

Phase 1 adds staff-operated photo capture and append-only AI evidence to the existing TypeScript, Hono, Drizzle, PostgreSQL, and OpenAI backend. A full session snapshots every active registered storage area at creation. Closing with an uncaptured required area leaves the session incomplete and preserves all successful observations. Individual sessions remain independent and use one selected area. Staff submit photos and close capture. The backend keeps structured evidence and per-photo metadata, with capture time and provenance when available. Any authenticated staff member can read that history. The session creator controls uploads and closure. The new workflow accepts no staff-entered quantities, first-area baselines, or reconciliation decisions.

Reuse `inventory_scans` for the upload and extraction record. Add four tables for canonical areas, sessions, session membership, and observations. Keep the existing stock and review workflow available through its current API. The evidence path cannot change stock, accepted area counts, transaction history, the product catalog, or accepted nutrition. A session close records the end of submissions. Coverage, uniqueness of physical items, and exact stock remain unresolved when the photos cannot establish them.

**Evidence basis.** Verified findings refer to the checked-out source, migrations, and test definitions. The full-session scope, per-photo timestamp requirement, staff visibility and owner-only writes, and transient image handling are finalized product decisions. Schema details, limits, and API examples below are proposed implementation contracts. No deployed schema, live data, provider configuration, or production behavior was verified. The repository review is [AI_INVENTORY_ARCHITECTURE_REVIEW.md](AI_INVENTORY_ARCHITECTURE_REVIEW.md).

## 2. Current backend architecture findings

| Surface | Verified behavior and relevant limits |
| --- | --- |
| Database and migration history | `src/db/index.ts` creates a node-postgres pool and binds the Drizzle schema. `0000_initial_schema.sql` defines categories, products, inventory, and stock transactions. `0001_ai_inventory_scanning.sql` adds scans, area counts, AI nutrition, product size/variation, and nullable audit fields on transactions. `0002_area_expiration.sql` adds a nullable date on the latest area count. The Drizzle journal and snapshots track these migrations. The migration runner refuses existing base application tables without a Drizzle journal. [Schema](src/db/schema.ts), [migrations](drizzle), [migration runner](scripts/migrate.ts) |
| Products and stock | Products have integer IDs, category FK, nullable brand/size/variation/barcode, a unique barcode, and manual nutrition JSON. Product creation also creates a zero-quantity inventory row transactionally. Stock has one integer total and unit per product. Product reads may include a separate AI nutrition candidate. [Product service](src/services/products.service.ts), [schema](src/db/schema.ts) |
| Upload and AI | Staff submits multipart `images` and one trimmed, lowercased free-text `area` to `POST /api/inventory/scans` with a UUID `Idempotency-Key`. Sharp validates and normalizes JPEG/PNG/WebP in memory and collapses identical normalized images within the request. OpenAI Responses receives the batch together, with structured output, `store: false`, a 90-second client timeout, and no SDK retries. The model receives neither area context nor prior observations. The DB stores the set fingerprint, analysis JSON, and separately editable review items. It stores no original or normalized image bytes, per-image IDs or hashes, or capture times. [Scan routes](src/routes/scans.ts), [image service](src/services/images.service.ts), [OpenAI service](src/services/openai.service.ts), [scan service](src/services/scans.service.ts) |
| Matching and upload replay | Matching requires one normalized name/brand/size/variation tuple with compatible barcodes. Barcode is not a standalone lookup. Ambiguity yields null. Two constraints enforce actor/key uniqueness and global fingerprint uniqueness. A same-area exact replay can return the existing row under another key, including failed/rejected rows. Crashes can strand `processing` rows. [Scan service](src/services/scans.service.ts), [scan migration](drizzle/0001_ai_inventory_scanning.sql) |
| Staff review, approval, rejection | Review edits pending items under a row lock, clearing stale identity-linked fields on changes. Only included, confirmed items with quantities and units can be applied. An existing product's first baseline requires `initialAreaQuantity`. Approval uses a transaction, advisory and row locks, stale checks, and unit/quantity checks. It adds the reviewed local delta to the current stock, upserts the area baseline, writes nonzero adjustment history, and may insert a new product or unverified nutrition. Reapproval returns the approved row. Rejection conditionally updates pending status and reviewer/time without a stock write. Original analysis is preserved. [Scan service](src/services/scans.service.ts) |
| Area counts and transaction history | `inventory_area_counts` stores one latest approved row per `(product_id, area text)`, with source scan, quantity, expiration, and update time. `GET /api/inventory/:id` includes these rows. Manual quantity PATCH and signed stock transactions update stock and history under a row lock, without updating area baselines. A later approved scan can therefore apply a delta for a change already reflected by a manual transaction. `/history` and `/transactions` read the same product ledger, including nullable legacy audit fields. Missing products during scan approval leave baselines alone. [Inventory service](src/services/inventory.service.ts), [inventory routes](src/routes/inventory.ts) |
| Routes, access, validation | `createApp` injects DB and optional staff credentials and vision analyzer. Auth guards resource routes under `/api`; health and the root are public. A valid `viewer` token receives 403. There are no area/session/observation routes. Scan analysis/review schemas use Zod and strict shapes with explicit nulls and confidence ranges; product, category, inventory and transaction validators use common strict-key, JSON/media, integral ID, and paging helpers. The global 64 KiB body limit exempts the existing scan upload path, which has its own 26 MiB limit. API errors are sanitized. [App](src/app.ts), [auth](src/middleware/auth.ts), [error handling](src/middleware/error-handler.ts), [validators](src/validators) |
| Automated tests | Node tests exercise Sharp, matcher, Zod, SDK payloads/errors and staff auth with mocks. PostgreSQL suites apply migrations and cover legacy scan replay, review edits, baseline/delta application, omissions, stale approvals, rollback, nutrition, legacy product/inventory/history, and concurrent removals. No evidence sessions/observations are tested today. CI provisions PostgreSQL 17 and requires the DB suites. [Scan unit tests](tests/scans.test.ts), [scan integration](tests/scans.integration.test.ts), [API integration](tests/api.integration.test.ts), [validation tests](tests/validation.test.ts), [CI](../.github/workflows/backend-ci.yml) |

## 3. Current architecture versus proposed architecture

| Concern | Current implementation | Phase 1 recommendation |
| --- | --- | --- |
| Location and grouping | One text label per scan | Stable area IDs and an explicit manifest. Full sessions require all active registered areas at opening. Individual sessions select exactly one active area. Multiple uploads per area are allowed. |
| Historical evidence | Original analysis JSON per legacy scan and mutable review items; current baseline overwrites its predecessor | Append-only observations indexed for new evidence, with immutable raw output and an ordered per-photo manifest. Each device-reported capture time stays separate from server upload time. Legacy snapshots remain available through the existing API. |
| Coverage and duplicates | Within-upload normalization and a prompt about overlap | Freeze the required-area manifest and derive capture completeness from successful uploads in each area. Preserve model visibility limits and image references. Block exact replay within an area/session. Cross-area or cross-time similarity remains evidence for later analysis. |
| Applying stock | Explicit human approval applies a local delta and depends on legacy baselines | New scan mode terminates at evidence ready or failure, outside the legacy approval state machine. Existing approved projections and writers retain their current semantics. |
| Scope from the architecture review | Proposed joint analysis, retained photos, versioned projection, movement and reconciliation records | Phase 1 groups structured evidence and keeps photos transient. Full-session deduplication, movement hypotheses, automatic application, historical AI context, visual comparison, image reprocessing, and student tools follow separately. |

## 4. Proposed database schema

**Conventions.** SQL names below are snake case; TypeScript and JSON use camel case. Required unless marked nullable. Timestamp columns use `timestamptz`; new UUID PKs default to `gen_random_uuid()`. Durable evidence links use restrictive delete/no-action update semantics. Actor IDs are server-derived `varchar(200)` snapshots from staff credentials; the repository has no staff table. Use DB constraints for row-local invariants and FKs, with Zod and service transactions for bounded JSON and cross-row rules.

### `inventory_areas`

Canonical photo locations. Coexists with the old text labels in legacy scans and baselines.

| Column | PostgreSQL type | Purpose |
| --- | --- | --- |
| `id` | `uuid` PK | Stable location identity |
| `name` | `varchar(120)` | Staff-visible location label |
| `archived_at` | `timestamptz` nullable | Exclude from new sessions while preserving history |
| `created_at` | `timestamptz DEFAULT now()` | Registration timestamp |

Trim names, reject blanks and control characters, and enforce case-insensitive uniqueness with a unique expression index on `lower(btrim(name))`, including archived rows. Let PostgreSQL determine conflicts so app and DB case folding agree. Name changes preserve IDs. Start with flat, bounded physical locations such as “Pantry / Shelf A”. Register mutually exclusive counting locations as an operational convention. Use this table's PK and name index initially. Defer hierarchies, view definitions, and alias records until there is an established way to identify overlapping scopes and legacy aliases.

### `inventory_scan_sessions`

A capture group and its lifecycle, independent of inventory acceptance.

| Column | PostgreSQL type | Purpose |
| --- | --- | --- |
| `id` | `uuid` PK | Session ID |
| `mode` | `varchar(16)` | `full` or `individual`, checked in PostgreSQL |
| `actor_id` | `varchar(200)` | Staff member who opened the session |
| `idempotency_key` | `uuid` | Creation key, unique with `actor_id` |
| `created_at` | `timestamptz DEFAULT now()` | Server time when capture grouping was opened |
| `closed_at` | `timestamptz` nullable | Set once when capture closes; check it is at or after creation |

Open/closed is derived from `closed_at`. A composite unique index on `(actor_id, idempotency_key)` supports replay. There is no session-list route in the initial contract, so defer an index for lifecycle listing. Store required areas once in the manifest. Create the session and all memberships atomically. Full mode snapshots all areas with `archived_at IS NULL` in a single database statement within that transaction. A later registration, archive, restore or rename never changes existing membership. Individual mode uses one validated active area. Reject creation with no active areas for full mode. Use the stored manifest on replay.

### `inventory_session_areas`

One row per required area, including areas that receive no upload. Full and individual sessions use the same relationship.

| Column | PostgreSQL type | Purpose |
| --- | --- | --- |
| `session_id` | `uuid` FK to `inventory_scan_sessions.id` | Capture group |
| `area_id` | `uuid` FK to `inventory_areas.id` | Intended area |

Composite PK `(session_id, area_id)`; add `(area_id, session_id)` for reverse lookup and FK operations. Derive capture status from associated scans. A required area counts as captured when it has at least one `evidence_ready` scan, including a valid extraction with zero items. A missing, pending, or failed batch alone does not satisfy the requirement. Derive session `captureCompleteness` as `complete` only when every manifest row meets the criterion, and `incomplete` otherwise. Query manifest and scan state from a consistent snapshot. Closure is independent and may record a closed, incomplete session. Closing resolves expired claims under the same lock used for finalization and prevents new claims. This stabilizes capture completeness after close. These fields describe capture workflow progress. Physical coverage and accepted stock remain separate. Coverage and visibility warnings stay with the source scans.

### Extend `inventory_scans`

Keep the current scan ID, actor/key, fingerprint, analysis, items, reviewer fields and audit timestamps. Use one scan row per normalized upload batch for one manifest area. Keep successful analysis immutable. Add evidence-specific provenance and a separate terminal success state.

| Column or change | PostgreSQL type | Rule |
| --- | --- | --- |
| `session_id`, `area_id` | `uuid` each, nullable for legacy | Paired nullability; composite FK to `inventory_session_areas(session_id, area_id)` |
| Existing `area` | `varchar(120)`, relax to nullable | Required for legacy scans, null for evidence scans. Resolve new area labels via FK. |
| Existing `status` | `varchar(30)` | Legacy statuses stay `processing/pending_review/approved/rejected/failed`; evidence permits only `processing/evidence_ready/failed`. Add DB checks keyed by association. |
| `uploaded_at` | `timestamptz`, nullable for legacy | Required for evidence. Server timestamp when the original multipart body was received and parsed, before normalization. Replays preserve the original timestamp. |
| `last_known_capture_at` | `timestamptz` nullable | Maximum device-reported timestamp from the photo manifest, for batch ordering only. Null when none is known. Derive on insert and preserve on retries. |
| `input_manifest` | `jsonb`, nullable for legacy | Required for evidence. Versioned metadata in multipart file order. Each entry carries an image ID, upload ordinal, device capture time or null, source, normalized SHA-256, dimensions, and a possible duplicate reference. Contains no bytes, file URLs, or raw EXIF. |
| `model_id`, `prompt_version`, `output_schema_version` | `varchar(120)`, `varchar(40)`, `varchar(40)`, nullable for legacy | Required for evidence. Set from the server-side analyzer configuration at claim time. `model_id` is the requested model identifier, so an alias may not identify immutable weights. |
| `attempt_number` | `integer`, nullable for legacy | Evidence starts at 1; increment when reusing a failed or expired claim. Check positive. |
| `claim_expires_at`, `analysis_finished_at` | `timestamptz` each, nullable | Set expiry only while evidence is processing; set finish time for the current terminal outcome. Preserve the original `created_at` across retries. |

Example manifest shape. The actual normalized hash is a 64-character lowercase hexadecimal value.

```json
{
  "version": 1,
  "normalizationVersion": "jpeg-v1",
  "images": [
    {"imageId":"i1","uploadOrdinal":0,"capturedAt":"2026-11-18T17:04:00.000Z","captureTimeSource":"device_reported","normalizedSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","width":2400,"height":1600,"duplicateOfImageId":null},
    {"imageId":"i2","uploadOrdinal":1,"capturedAt":null,"captureTimeSource":"unknown","normalizedSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","width":1600,"height":1200,"duplicateOfImageId":null}
  ]
}
```

Assign a scan-local ID to every submitted photo in original multipart order. Record exact normalized duplicates as separate metadata entries pointing to the first matching image ID. Send only the first representative to AI, so analysis references point to IDs that were actually sent. Do not infer device capture order from upload ordinal or carry a duplicate entry's timestamp over to its representative. Use `device_reported` only when a capture timestamp is supplied, and `unknown` only with null. Device provenance records what the client reported, with no independent verification of the camera clock. The parent scan's `uploaded_at` provides server receipt time for the batch and is never substituted for capture time. Derive the earliest known capture time on read if needed. Neither the earliest nor latest known time bounds the timestamps of photos with unknown capture times.

Keep the unique `(actor_id, idempotency_key)` index across both modes. Replace the original global fingerprint constraint with a legacy partial unique index on `(fingerprint)` where `session_id IS NULL` and an evidence partial unique index on `(session_id, area_id, fingerprint)` where `session_id IS NOT NULL`. Evidence hash input is the versioned sorted set of normalized hashes; legacy computation remains byte-for-byte compatible. Add a partial `(area_id, last_known_capture_at DESC NULLS LAST, uploaded_at DESC, id DESC)` index for evidence history and keep `scans_created_idx` for existing listing. The session-prefixed evidence unique index also serves session/area reads. Add checks for allowed field/state combinations including empty legacy review items, null reviewer fields, and null legacy-area text on evidence rows. Scope every legacy scan lookup and fingerprint fallback to legacy rows and explicitly preserve legacy DTO fields. Model types should distinguish legacy and evidence analysis JSON after narrowing by session association.

### `inventory_observations`

One immutable row per detected item in a successful evidence extraction. Retain distinct detections of the same catalog product and expose overlap uncertainty.

| Column | PostgreSQL type | Purpose |
| --- | --- | --- |
| `id` | `uuid` PK | Stable observation ID |
| `scan_id` | `uuid` FK to `inventory_scans.id` | Source upload and provenance |
| `item_index` | `integer` | Zero-based index into immutable, versioned `analysis.items` |
| `product_id` | `integer` nullable FK to `products.id` | Unique backend match when supported |
| `match_status` | `varchar(24)` | `matched`, `unmatched`, `ambiguous`, or `conflict` |
| `quantity_kind` | `varchar(16)` | `visible_count`, `estimate`, or `unknown` |
| `quantity`, `quantity_lower`, `quantity_upper` | `integer` each, nullable | Local observation estimate/count and optional estimate bounds |
| `unit` | `varchar(50)` nullable | Observed count unit, independent of the accepted stock unit |
| `identity_confidence`, `quantity_confidence` | `double precision` each, nullable | Separate model scores where supplied, checked within [0,1] |

Unique `(scan_id, item_index)`; check ordinal 0–199 and enforce item existence and version compatibility in the write service. Check match/product consistency, valid enum values, nonnegative quantities, and trimmed unit if supplied. Numeric counts require an observed unit and positive quantity. Phase 1 represents empty extraction at the scan level and stores no zero-product observations. `unknown` has null quantity and bounds; optional bounds apply only to an estimate and must be consistent with it. Enforce app-only inserts in the evidence finalization service; the FK establishes source existence and the service ensures it is a successfully finalized evidence scan within the same transaction. Add `(product_id, scan_id, id)` for product filtering. Join through the scan for area, session, server upload time and versions. Resolve an observation’s `sourceImageIds` from its raw item to the corresponding ordered manifest entries by `(scan_id, image_id)`. Only source images supply photo capture times for that observation, and an observation can cite multiple photos with distinct or unknown times. Keep observed label text, per-image references, warnings, overlap hints and any extracted label attributes in the raw item at `item_index`. The query fields extracted into columns allow indexed reads without duplicating whole JSON items. Defer correction/supersession records until versioned reanalysis is implemented.

### `inventory_reconciliations` and accepted stock

Defer this table. There are no Phase 1 proposals, accepted revisions, policy inputs or decisions to store. A later phase should define reconciliation inputs, projection versioning and audit constraints together. Existing `inventory`, `inventory_area_counts`, `inventory_transactions`, `products`, `categories`, and `product_nutrition` retain their current tables, fields, and semantics. A legacy review decision can still change stock through its existing route. An evidence scan never enters that flow.

## 5. Table relationships

```text
inventory_scan_sessions 1 ─── * inventory_session_areas * ─── 1 inventory_areas
                                         │
                                         1
                                         │
                                         *  (nullable association for legacy)
                                  inventory_scans
                                         1
                                         │
                                         *
products 1 ── * (optional match) inventory_observations
```

Existing scan references from `inventory_area_counts`, `inventory_transactions` and `product_nutrition` remain intact. Phase 1 creates no such references to evidence scans. A product may have zero or many observations; observations can exist without a product. Several scans can contribute evidence to the same area in a session. The manifest can exist with zero successful scans. A full manifest contains every area active at creation and persists even if a session closes incomplete.

## 6. Existing data migration strategy

1. **Rehearse on disposable PostgreSQL.** Seed a database at the end of `0002` with representative products, zero/nonzero and unallocated stock, several text areas, date-bearing baselines, all scan states, distinct original and reviewed JSON, candidate nutrition, and transactions both with and without audit metadata. Cover legacy quantities that could not be reconstructed by summing area counts.
2. **Extend in a new reviewed Drizzle migration.** Keep the existing SQL, journal entries and snapshots intact. Generate the next numbered migration plus metadata from the new schema, then review FK order, existing status and text assumptions, nulls, and fingerprint constraint replacement. Establish the legacy partial unique index before dropping the old constraint to preserve its guarantee throughout the migration. Rehearse locking and runtime against realistic volume. If an unexpected status or schema drift would violate a new check, stop and inspect the rows before any data repair. An unjournaled deployed schema requires separate schema verification and reconciliation.
3. **Leave historical values in place.** Preserve existing IDs, product attributes, stock quantities/units/thresholds, baseline text/date/quantity/scan links, all scan statuses and reviewer fields, immutable analysis and mutable review results, nutrition records, transaction deltas, and nullable audit fields. Phase 1 does no stock recomputation or allocation. Historic totals remain the existing operational totals whose physical coverage is unverified.
4. **Register canonical areas independently.** Register all staff-verified active storage locations before enabling full capture because the snapshot can cover only registered areas. A future read-only inventory of distinct strings from both scans and baselines can inform that registration. Automatic trim/case/alias merging cannot determine whether two names refer to the same shelf, different shelves, or parent/child views. Keep original strings and document approved mappings before any future legacy linkage. Skip uncertain labels and avoid synthetic sessions. Neither canonical renames nor archives alter legacy lookup keys.
5. **Keep legacy history accessible.** The legacy scan detail API remains the source for past AI results and staff review. The new historical endpoint reads structured evidence from Phase 1 onward. A later versioned adapter or idempotent backfill could expose legacy detections alongside new results as explicitly legacy evidence. Such work would need stable item ordinals, validated area mappings and explicit nulls for unknown provenance. Never use edited review quantities or staff-selected identities as the original detection. Approval may have created a product whose ID was unavailable at extraction time.
6. **Roll out by deploying the compatible readers before opening capture.** Avoid mixed binaries serving evidence traffic because old scan listing/detail and fallback lookups were unscoped. Pause the new workflow at the API boundary if needed and keep the additive schema and evidence. Prefer a forward fix; after evidence has been collected, restoring the old global fingerprint constraint can fail on legitimate cross-scope reuse, and dropping the evidence tables would erase history. Re-run parity checks on the rehearsal fixture and confirm legacy API contracts before enabling evidence traffic.

Legacy records cannot reliably establish camera capture time or intervals, original bytes, individual image hashes, image-to-item links, unrecorded views, physical coverage, within-session membership, underlying model/prompt versions, calibrated confidence, or historical inventory distribution outside known baselines. Scan creation, review, and ledger timestamps keep their original server-side meanings. A quantity change alone cannot reconstruct consumption, movement or receipt.

## 7. Backend file changes

All paths in this table are relative to `backend/`. These are future changes.

| File | Action and responsibility |
| --- | --- |
| `src/db/schema.ts`, `drizzle/0003_*.sql`, `drizzle/0004_*.sql`, `drizzle/meta/0003_snapshot.json`, `drizzle/meta/0004_snapshot.json`, `drizzle/meta/_journal.json` | Extend schema, generate and review migration and metadata. Retain current DB connection factory and migration runner. |
| `src/app.ts` | Mount area, session and observation routers; pass a separately injectable evidence vision analyzer through app options. Reuse global staff auth, error handling, and the current multipart exemption. Register fixed resource routes ahead of the generic inventory router. |
| `src/routes/inventory-areas.ts`, `src/validators/inventory-areas.ts`, `src/services/inventory-areas.service.ts` | Create, list, rename and archive areas. Validate JSON and pagination; have the service own name normalization, archive transitions and DTOs. |
| `src/routes/scan-sessions.ts`, `src/validators/scan-sessions.ts`, `src/services/scan-sessions.service.ts` | Create/replay active-area snapshots or individual manifests, read capture completeness and close sessions. Centralize session row locking and owner/area checks for use by evidence upload. |
| `src/routes/scans.ts` | Parse two mutually exclusive multipart shapes at the existing URL. Dispatch legacy form to `ScansService`, evidence form to the new service. Retain the existing legacy responses and upload limits. |
| `src/services/scans.service.ts` | Scope legacy reads, replay lookup, review, approval and rejection to legacy rows. Project legacy response fields explicitly. Reuse the existing identity normalization in a small shared matcher if it can preserve legacy behavior. |
| `src/services/images.service.ts` | Expose normalized dimensions and a normalization version to evidence capture. Keep original multipart photo ordinals and assign scan-local IDs in that order. Produce a metadata entry per file while sending normalized duplicate images to AI only once. Preserve legacy normalization, input ordering and fingerprint semantics. |
| `src/services/evidence-vision.service.ts`, `src/services/openai.service.ts` | Add an injectable evidence analyzer and versioned prompt with stable image labels preceding each image. Reuse the current OpenAI client construction and error translation where compatible. Keep legacy analysis types and status semantics. Use explicit structured-output version names and keep all image text untrusted. |
| `src/services/evidence-scans.service.ts`, `src/validators/evidence-scans.ts` | Own multipart photo metadata validation, server upload time, fingerprint/manifest creation, replay, claim expiry, extraction validation, product matching, and transactional evidence finalization. Keep vision outside transactions and restrict writes to scans and observations. |
| `src/routes/observations.ts`, `src/validators/observations.ts`, `src/services/observations.service.ts` | Validate query filters and paging. Join observations to ready scans and map the raw item at its ordinal into stable, version-aware DTOs. Provide the observation insert mapping for evidence finalization against its transaction handle. |
| `tests/evidence.test.ts`, `tests/evidence.integration.test.ts`, `tests/evidence-migration.integration.test.ts` | Add mocks and real-database tests described below. Extend `tests/scans.test.ts` and `tests/scans.integration.test.ts` for cross-mode route and response regression. |
| `docs/API.md`, `docs/INVENTORY_SCANNING.md` | Document the two upload forms, status codes, capture and review behavior, retry instructions and image policy. |

Existing auth, inventory mutation, product mutation, and category modules need no feature changes. Use the current error handler and throw named `ApiError` values for expected state conflicts. For PostgreSQL failures, preserve the handler's general behavior and avoid leaking SQL or provider payloads.

### Capture and transaction boundaries

1. **Snapshot required areas.** In the session creation transaction, use a single active-area selection statement and write exactly that set for full mode. For individual mode validate and select the one supplied active area. Treat the database statement snapshot as the concurrency boundary for registrations and archives. Replay full creation by mode and key using the original manifest, without taking a new snapshot. Individual replay compares mode and supplied ID. An area archived later remains required and usable in sessions that already include it.
2. **Claim or replay.** Normalize the bounded upload in memory and compute its manifest and fingerprint. In a short transaction lock the session row, require its creator for writes, verify membership, and resolve the actor/key before inserting. All upload state changes and session close acquire the session lock before any child scan lock. Match replays on actor/key, mode, session, area, and the ordered photo metadata and normalized hash sequence. Compare UTC-normalized device times and their nulls per photo, excluding server timestamps. Changing order, files or capture metadata under the same key is a conflict. The separate scoped set fingerprint is order-independent and detects the same normalized content under a different key. Limit each area to five distinct evidence uploads per session, counting failed rows; replays and claims of existing rows do not consume another slot. A different key with the same scoped fingerprint returns a duplicate conflict. Database uniqueness remains the final guard, including cross-session actor/key races. Re-read the conflicting row if a concurrent insertion wins.
3. **Analyze outside the transaction.** For a new or reclaimed processing row, call the injected analyzer with normalized images and stable IDs. Record analyzer versions for the current claim. Choose a claim expiry greater than the analyzer's bounded request time plus validation/finalization margin, initially 120 seconds for the existing 90-second OpenAI timeout. Use database time for claim/expiry transitions. Validate model results structurally and then validate their cross-field semantics and image references before saving.
4. **Finalize atomically.** Re-lock session and scan, require the same processing attempt number and an unexpired claim, resolve products from the catalog, store raw validated analysis and insert all observations, and move the scan to `evidence_ready` with a finish time. A failed write rolls this whole transaction back. If an attempt fails while still active, mark it `failed` with a safe code in a separate transaction that follows the same locking order and matches the current unexpired attempt, clearing the lease. A superseded attempt cannot commit observations or alter a newer claim. The raw analysis of a successful scan and its observations have no update path in Phase 1.
5. **Recover and close.** A matching upload replay on an open session reuses an `evidence_ready` result, returns 202 for an active claim, or reclaims the same row for a failed/expired claim. A matching terminal replay also works after closure, regardless of later area changes. Reclaim requires the caller to resupply identical photos because bytes are transient. Apply a three-attempt cap including the first call. Keep the current attempt state and latest terminal error on the scan row. Phase 1 has no per-attempt audit table. Surface a non-retryable conflict once exhausted. In the absence of a retry, report expired processing as `failed` with `CLAIM_EXPIRED` in session reads. Close converts expired processing claims to failed with `CLAIM_EXPIRED` in the same transaction. Close conflicts while any unexpired claim is processing; it otherwise succeeds even with failed or missing areas. Derive completeness from the frozen manifest and finalized evidence, and preserve all successful observations when closing incomplete. After close, allow read-only replay of terminal uploads and return `SESSION_CLOSED` for new uploads. There is no worker or background analysis in Phase 1.

## 8. API specifications

All examples below describe the proposed contract. Preserve the existing staff bearer authentication and unrelated route permissions. Any authenticated staff member may list/manage areas and view historical observations, associated session details, and scan summaries and photo metadata, regardless of session ownership. Only the session creator may upload photos, retry an upload, or close that session. The viewer role remains forbidden. Derive the actor from auth, never from request JSON. A missing/invalid token yields `401 UNAUTHORIZED`, a viewer or unauthorized session writer yields `403 FORBIDDEN`, and unexpected errors yield a sanitized `500 INTERNAL_ERROR`. Use current `{ "data": ... }` and `{ "error": { "code": "...", "message": "..." } }` envelopes. Strict JSON, unique query/form fields where scalar, positive bounded pagination, UUID path IDs, and rejection of unsupported fields are common. JSON routes share the 64 KiB limit with 413 on overflow and 415 for unsupported media. Read requests have no body.

Example IDs used below are area `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, session `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, and scan `cccccccc-cccc-4ccc-8ccc-cccccccccccc`. Shortened examples show the fields clients need for the indicated operation.

### Area registration and selection

| Method and route | Request and response examples | Validation and additional errors |
| --- | --- | --- |
| `POST /api/inventory/areas` | JSON `{"name":"Pantry / Shelf A"}`. **201** `{"data":{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"Pantry / Shelf A","archivedAt":null,"createdAt":"2026-11-18T17:00:00Z"}}`. | Trim 1–120 characters; reject control characters and extra fields. **400** malformed input; **409 AREA_NAME_CONFLICT** includes a collision with an archived name. |
| `GET /api/inventory/areas?page=1&limit=20` | No body. **200** `{"data":[{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"Pantry / Shelf A","archivedAt":null,"createdAt":"2026-11-18T17:00:00Z"}],"pagination":{"page":1,"limit":20,"hasMore":false}}`. | Active areas by default; optional `includeArchived=true\|false`. Sort by normalized name then ID. Use current pagination defaults and limits. **400** invalid query. |
| `PATCH /api/inventory/areas/:areaId` | JSON `{"name":"Pantry / North Shelf"}` or `{"archived":true}`. **200** updated area DTO as above, with updated `name` and/or `archivedAt`. | Allow name and/or a boolean `archived` in a nonempty patch; `false` restores, true on an archived row is idempotent. **400** malformed input; **404 AREA_NOT_FOUND**; **409 AREA_NAME_CONFLICT**. |

### Session lifecycle

**POST `/api/inventory/scan-sessions`** creates the required-area manifest. Send UUID `Idempotency-Key`. For a full session, send this body and let the server snapshot the active area register.

```json
{"mode":"full"}
```

For a separate individual session, supply the one selected area.

```json
{"mode":"individual","areaIds":["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]}
```

```json
{"data":{"id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","mode":"individual","createdAt":"2026-11-18T17:03:00Z","closedAt":null,"captureCompleteness":"incomplete","areas":[{"areaId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"Pantry / Shelf A","captureStatus":"missing","scans":[]}]}}
```

Return 201 on creation and 200 on identical replay, with `Location: /api/inventory/scan-sessions/:sessionId`. Use the same response shape for full sessions, with `mode: "full"` and one entry for each area in the server snapshot. Accept exactly one UUID for `individual` and reject an `areaIds` field in `full` mode. A full session can have one active area. A replay returns the stored area set and current status even after the active register changes. Use **400** for shape or mode/cardinality errors, **404 AREA_NOT_FOUND** for an unknown individual area, **409 AREA_ARCHIVED** for selecting an archived individual area, **409 NO_ACTIVE_AREAS** for a full session with no active areas, and **409 IDEMPOTENCY_CONFLICT** for a used key with a different mode or individual area.

**GET `/api/inventory/scan-sessions/:sessionId`** returns lifecycle, capture completeness and every manifest area, including its scan metadata, with no body. Any staff member can read this response. **200** uses the creation DTO. This example shows the area entry after one successful upload.

```json
{"areaId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","name":"Pantry / Shelf A","captureStatus":"has_evidence","scans":[{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","status":"evidence_ready","uploadedAt":"2026-11-18T17:05:00Z","analysisFinishedAt":"2026-11-18T17:05:08Z","photos":[{"imageId":"i1","uploadOrdinal":0,"capturedAt":"2026-11-18T17:04:00Z","captureTimeSource":"device_reported","duplicateOfImageId":null},{"imageId":"i2","uploadOrdinal":1,"capturedAt":null,"captureTimeSource":"unknown","duplicateOfImageId":null}],"observationCount":1,"visibility":"partial","warnings":["Rear shelf obstructed"],"errorCode":null}]}
```

`captureStatus` is `has_evidence` if any successful scan exists, otherwise `processing` if any claim is active, `failed` if only failed or expired scans exist, or `missing` if none exist. Include individual scan statuses so a mix of successful, failed and pending uploads is visible. A successful zero-item extraction still produces `has_evidence` with `observationCount: 0`. `visibility` and warnings are model evidence, with `visibility: null` before successful extraction. `captureCompleteness` is `complete` only when each required area has `has_evidence`. Only a closed session with that result is a completed capture session. Neither status provides a stock quantity or a guarantee of physical coverage. Errors are **400** invalid UUID/query and **404 SESSION_NOT_FOUND**.

**POST `/api/inventory/scan-sessions/:sessionId/close`** declares capture closed. Send no body. **200** returns the session DTO with `closedAt` set, even on replay. Invalid UUID or nonempty body gives **400**, unknown ID gives **404 SESSION_NOT_FOUND**, and an active processing claim gives **409 SESSION_PROCESSING**. If any required area has no ready evidence, return `closedAt` with `captureCompleteness: "incomplete"`. Missing or failed areas remain in the manifest and successful observations remain queryable. With ready evidence for every required area, return `closedAt` with `captureCompleteness: "complete"`. Neither outcome reconciles stock.

### Associate a new photo batch

**POST `/api/inventory/scans`** keeps the existing legacy form and adds an evidence form. Send UUID `Idempotency-Key` and `multipart/form-data` with the following fields.

```text
sessionId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb
areaId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
images=@pantry-shelf.jpg
images=@label.jpg
photoMetadata=[{"deviceCapturedAt":"2026-11-18T17:04:00Z"},{"deviceCapturedAt":null}]
```

```json
{"data":{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","areaId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","status":"evidence_ready","uploadedAt":"2026-11-18T17:05:00Z","photos":[{"imageId":"i1","uploadOrdinal":0,"capturedAt":"2026-11-18T17:04:00Z","captureTimeSource":"device_reported","duplicateOfImageId":null},{"imageId":"i2","uploadOrdinal":1,"capturedAt":null,"captureTimeSource":"unknown","duplicateOfImageId":null}],"analysisFinishedAt":"2026-11-18T17:05:08Z","observationCount":1,"visibility":"partial","warnings":["Rear shelf obstructed"],"errorCode":null}}
```

- **Success.** 201 for first completion, 200 for a terminal replay or successful retry of an existing row, and 202 when an existing claim is active. A terminal replay after closure can report a persisted failure with 200 and `errorCode`. Evidence responses can include the session URI in `Location` for status recovery. Existing scan list/detail and review/approve/reject routes remain legacy-only and return 404 for an evidence ID where applicable.
- **Validation.** Require both IDs exactly once and disallow `area` in the evidence form. `photoMetadata` is an optional single multipart text field with a strict JSON array, one entry per file in the original `images` order before deduplication. Each entry has exactly one `deviceCapturedAt` property, either an RFC 3339 timestamp with an explicit offset and at most millisecond precision or null. Omission means every capture time is unknown. Canonicalize valid timestamps to UTC and preserve supplied nulls. Photos may have different timestamps, arrive out of chronological order, or predate the session. Reject malformed, mismatched, or repeated metadata with **400 VALIDATION_ERROR**. The server alone sets `uploadedAt` and `captureTimeSource`. A clock-skew policy for syntactically valid device times remains an implementation decision. Keep 1–5 JPEG/PNG/WebP files, 8 MiB/file, 24 MiB combined, 26 MiB multipart, and the existing decode/pixel limit. Auth and inexpensive form validation precede processing; validate ownership, membership and session state again when claiming under lock.
- **Errors.** **400 VALIDATION_ERROR / INVALID_IMAGES / INVALID_IMAGE** for malformed input, **413 BODY_TOO_LARGE / IMAGE_TOO_LARGE**, **415 UNSUPPORTED_MEDIA_TYPE / INVALID_IMAGE_TYPE**. Unknown session gives **404 SESSION_NOT_FOUND**. Missing membership gives **409 AREA_NOT_IN_SESSION** whether the area exists elsewhere or not. Return **409 SESSION_CLOSED**, **IDEMPOTENCY_CONFLICT**, **DUPLICATE_SCAN**, **UPLOAD_LIMIT**, **RETRY_LIMIT**, or **CLAIM_EXPIRED** for the matching state conflict. Retain safe upstream codes such as **429 AI_RATE_LIMIT**, **502 INVALID_AI_RESPONSE / AI_UNAVAILABLE**, **503 AI_NOT_CONFIGURED**, and **504 AI_TIMEOUT**; messages for evidence retries should direct callers to the same key and photos. If an accepted upload fails, preserve its safe failure status in session detail.

### Retrieve observations

**GET `/api/inventory/observations?areaId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&page=1&limit=20`** has no body. Require at least one of `areaId`, `sessionId`, `scanId`, or positive integer `productId`. Combine filters by intersection. Default page 1 and limit 20; maximum limit 100. Sort by the batch’s `last_known_capture_at DESC NULLS LAST`, then `uploaded_at DESC`, scan ID descending and item ordinal ascending. The sort key is for browsing batches. It does not supply a capture time to any observation or source image. Keep the scan area/time index in that order. Offset pages are live, so refresh from page 1 when new evidence arrives during paging. Use **400** for invalid or repeated filters or pagination. A valid nonmatching ID or combination gives **200** with an empty page, including queries for a session whose captures yielded no observations. Use session detail to distinguish missing, failed and empty captures. The query excludes legacy scans and includes unresolved observations unless a product filter is supplied. History includes observations from closed incomplete sessions. Any authenticated staff member can follow the returned session and scan IDs to session detail and its scan summaries. Return `sourceImages` in upload order with photo metadata resolved from the manifest.

```json
{
  "data": [{
    "id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    "scanId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "sessionId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "areaId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "itemIndex":0,
    "uploadedAt":"2026-11-18T17:05:00Z",
    "recordedAt":"2026-11-18T17:05:08Z",
    "modelId":"gpt-5-mini",
    "promptVersion":"evidence-1",
    "outputSchemaVersion":"1",
    "productId":42,
    "matchStatus":"matched",
    "detectedIdentity":{"productName":"Black Beans","brand":"Example","packageSize":"15 oz","variation":null,"barcode":null},
    "identityConfidence":0.91,
    "quantityKind":"visible_count",
    "quantity":4,
    "quantityLower":null,
    "quantityUpper":null,
    "quantityConfidence":0.8,
    "unit":"can",
    "visibility":"partial",
    "warnings":["Only front row visible"],
    "sourceImageIds":["i1","i2"],
    "sourceImages":[
      {"imageId":"i1","uploadOrdinal":0,"capturedAt":"2026-11-18T17:04:00Z","captureTimeSource":"device_reported"},
      {"imageId":"i2","uploadOrdinal":1,"capturedAt":null,"captureTimeSource":"unknown"}
    ],
    "overlapHint":"possible"
  }],
  "pagination":{"page":1,"limit":20,"hasMore":false}
}
```

No public observation write route is needed. Neither an independent association endpoint nor a legacy scan reassignment is needed because association is established before extraction. Defer general session listing, manifest editing, observation editing, photo reprocessing, image access, and inventory reconciliation APIs. Keep and use the session ID returned at creation for reload/recovery in the pilot.

## 9. AI observation structure and semantics

**Prompt inputs.** Supply only the current batch, with explicit labels such as “Current image i1” before each image and instructions to report local visible products, look for overlap within the batch, and identify the images that support each detection. Use the original upload order to assign photo IDs scoped to `scanId`. Send the distinct normalized analysis representatives with their assigned IDs. Keep area ID and session identity server-owned. Phase 1 analyzes newly submitted photos. A future analyzer can retrieve the saved structured history as context. Historical pixels and stock quantities are outside the Phase 1 extraction context. Treat shelf and label text as data.

**Wire format.** Use a separate strict versioned Zod schema for Responses structured output. Include top-level `items` (0–200), `visibility`, and `warnings`. Visibility values `limited_view`, `partial`, and `unknown` describe what the model could inspect. Even `limited_view`, meaning the submitted view looked readable without a flagged obstruction, says nothing about the rest of the area. Reuse current warning and item text bounds. Each item has nullable identity text fields (name, brand, package size, variation, barcode, optional category text represented as null when unknown), separate nullable identity and quantity scores, nullable estimated quantity/unit/bounds, count kind, item visibility, warnings, source image IDs, and an overlap hint. Use `unknown`, `possible`, or `none_reported` for overlap. Optional label facts such as expiration or readable nutrition can reuse existing validated schemas and remain inside the immutable raw item; preserve nulls for unreadable fields and leave nutrition promotion and batch/lot modeling out of the new workflow.

**Server validation and matching.**

- Check strict object/array bounds, scores, enum values, and canonical count-kind rules before persistence. Every item requires 1–5 unique local image IDs that resolve to distinct analysis representatives sent to the model. Reject bad references with `INVALID_AI_RESPONSE`; do not silently substitute another image. Unknown quantity and unavailable confidence remain explicit nulls. When quantity is supported, report an observed unit like `can` or `package`; package size such as “15 oz” belongs to identity. Do not convert units or serving counts to accepted stock units.
- Compare the detected normalized identity tuple to the catalog via the backend. A sole compatible product is `matched`; no candidates is `unmatched`; multiple compatible candidates is `ambiguous`; contradictory identity/barcode evidence is `conflict`. Treat a barcode that points to a different existing product, or disproves the only otherwise plausible tuple, as a conflict. If some tuple candidates lack barcodes, do not use a conflicting nonnull barcode to grant a match to a missing-barcode candidate. Barcode-only extraction stays unresolved in this version. Keep `productId` nullable and do not auto-create products or accept model-supplied IDs. A match status records how the backend resolved the catalog association. Model identity confidence describes extraction and is not a calibrated catalog match probability.
- A typical row means “approximately or visibly this many items in these images for this source scan.” It conveys neither accepted quantity nor completeness. An empty extraction, obscured view, and missing upload remain distinct. None creates negative or zero stock evidence. A lower count in a later photo alone establishes no cause, and no arithmetic is applied across scans or sessions.
- Exact duplicate hashes in one upload collapse into one model input while retaining each file’s metadata and upload ordinal. The same versioned set in one session/area can finalize only once. Hashes persist even when the same set is permitted in another scope. They establish exact normalized input equality, not repeated physical-item identity or a second independent capture. Overlap hints are local, advisory signals. A later session analyzer can join observations with ordered source manifests and per-photo capture provenance and compare repeated hashes, then reason about shared objects. Different viewpoints of the same packages and items moved between areas remain unresolved here.

Read each source photo’s `capturedAt` and `captureTimeSource` from its manifest entry. Use the parent scan for `uploadedAt` (server request receipt) and `recordedAt` (server analysis finish). Neither is used as a device capture time, and an observation spanning multiple photos has no single synthetic capture time. Migrations or future schema versions must keep historical raw JSON decoders available. Reanalysis and corrections should append linked evidence with original capture provenance when introduced.

## 10. Finalized image retention decision

**Verified current behavior.** Sharp handles original bytes and builds normalized JPEGs and base64 inputs in memory. The OpenAI request uses `store: false`. PostgreSQL currently retains a combined fingerprint, not image bytes. Repo code supplies no organizational authorization, actual provider retention settings, or retention policy. [Image service](src/services/images.service.ts), [OpenAI service](src/services/openai.service.ts), [current scanning guide](docs/INVENTORY_SCANNING.md)

| Consideration | Phase 1 structured observations and metadata | Possible future selective image retention |
| --- | --- | --- |
| Costs | PostgreSQL holds bounded JSON and hashes. The vision request and in-memory processing still cost time and compute. | Adds object storage, transfer, lifecycle handling, monitoring and any repeated vision calls. Estimate using actual upload counts, normalized sizes and retention days. |
| Privacy | Limits local exposure of faces, identifying labels and location details. Extracted text and metadata can still be sensitive; restrict access and avoid logging payloads. | Adds access to scene content. Crop to useful views, avoid identifying details at capture, and document purpose and exceptions. |
| Access and deletion | Staff-only evidence reads using the API above. Images have no local retrieval or deletion lifecycle. Set the retention schedule, backup policy and purge owner for structured evidence. | Use one private object store with encryption, scoped service permissions, staff access through short-lived authorized links, access auditing, TTL/lifecycle deletion and documented backup/deletion handling. Keep surviving evidence references marked deleted. |
| Visual comparison | Compare dated structured detections, context and exact hashes. The system cannot visually check a different viewpoint, inspect a misread label, or recover details omitted by extraction. | Compare retained images by capture time, role and area. Reprocess actual pixels with a later model while preserving original capture time. Normalization and crop selection can lose detail even with storage. |

**Final decision.** Phase 1 analyzes newly submitted photos and keeps structured observations, scan provenance, and ordered per-photo metadata. Original and normalized bytes remain transient during request handling. Do not persist them in PostgreSQL, S3, local durable disk, or any other persistent store. Do not save raw EXIF or base64 in logs. The same files must be resupplied for an upload retry. Historical AI can use the saved detections and their provenance in a later phase. Historical visual comparison and photo reprocessing are deferred, and Phase 1 photos will be unavailable for those features.

Before rollout, confirm the institutional photo policy, permitted structured-evidence retention and deletion with backups, and actual provider account controls. `store: false` is a request setting and does not guarantee zero provider retention. These checks do not reopen the decision to keep Phase 1 photographs transient.

## 11. Testing strategy

| Scope | Mock or pure test | Real disposable PostgreSQL test |
| --- | --- | --- |
| Areas and manifests | Validate names, trim and strict fields, normalized UUIDs, filter flags, full requests without area IDs and individual requests with exactly one. Test API wiring. | Create/list/rename/archive/restore, case-insensitive collision, select active area, reject unknown and archived IDs, preserve membership after rename/archive. Test full snapshots that include every active area and exclude archived areas, one and zero active areas, and registration or archive on each side of the snapshot. Ensure later area changes cannot rewrite a manifest. Test full replay after registry changes and changed mode or individual area conflicts. |
| Upload and association | Real Sharp on tiny fixtures. Mock the model to check ordered IDs, duplicate representatives and versioned payload. Validate positional metadata, missing metadata, mixed known/unknown and out-of-order device times, offset conversion, count mismatch and malformed timestamps. Assert upload multipart limits and disjoint legacy/evidence shapes. | Full mode with multiple areas and uploads, individual mode with one area and multiple uploads, wrong membership and unknown session, direct invalid composite FK inserts, closed session writes, and no reassignment. In a full session, test a successful empty extraction that counts toward capture, a failed area and a missing area. Close incomplete and retrieve saved observations. In a separate session capture every required area and verify complete closure without stock writes. |
| Persist and retrieve | Mock responses with ambiguous/conflicting identities, confidence and uncertainty, unknown quantities, invalid ranges, unknown image references, refusal, malformed output and timeouts. Validate combined filter rules and DTO decoding. | Assert raw JSON and ordinals, nullable FK and confidence behavior, per-photo capture times and sources joined by ID, upload order with out-of-order timestamps, no timestamp substitution, late upload of older photos, deterministic paging/filtering, multiple observations for one product, and history across full and individual sessions. Ensure older rows remain readable and immutable after later scans and area rename/archive. Exercise quantity and state constraints directly. |
| Duplicate prevention and recovery | Test scoped set fingerprint stability under reorder/exact duplicates and version changes. Check ordered replay identity separately, and spy on model inputs. | Same key with identical request, reordered files, or changed photo metadata; same distinct image set under different keys in the same scope; permitted same set in another scope; duplicate images within an upload. Race identical claims and a cross-session actor/key collision, checking one accepted claim per request. Exercise failed/expired retry, attempt cap, stale response fencing, and both upload/close interleavings. Use an injected clock where possible or set expiry on test fixture rows. |
| Rollback | Mock provider failures for safe external errors and no retry inside the SDK. | Force failure in membership insertion and after at least one observation insert, for example via a test-scoped database trigger or constraint. Verify no partial manifest, raw success state, or observation rows, and verify the scan's separately recorded failure and successful retry. |
| Stock and legacy compatibility | Verify evidence write DTOs contain no review fields or stock quantities. Keep legacy unit tests around normalization, validation and error mapping. | Run legacy suites. Compare stock, legacy area counts, products, transaction history and both nutrition representations before/after evidence success, empty results, failures, replays and closure. Assert evidence IDs cannot use legacy detail/review/reject/approve and no evidence scans enter legacy lists. Verify reviewed legacy approve/reject still works and retain the old JSON DTO shapes, text-area deltas and legacy replay behavior. |
| Authorization | Use `createApp` with fake DB/vision and staff fixtures. Test 401 for no/bad token and 403 for viewers across new reads/writes before DB or AI access. | Test that a second staff member can read observations from complete and incomplete captures plus session and scan metadata. Verify non-owner upload/retry/close receives 403 without writes or AI calls. Check unrelated endpoints retain their access behavior and clients cannot override actors. |
| Migration | Inspect SQL and compare Drizzle schema against migration generation in the implementation review. | In a separate disposable migration test, apply only through `0002`, seed the Section 6 fixture, apply the Phase 1 migrations, and compare all legacy columns, row IDs and links before/after. Also verify clean install through the full journal, old legacy uniqueness, new partial uniqueness and existing journal behavior. |

Use fake vision responses in CI, including DB integration. Verify persisted metadata and API results contain no image bytes, base64, raw EXIF, or stored-file references, and confirm the upload path has no durable file or object writes. Do not depend on provider calls to test constraints, locks, isolation, or rollback. For eventual rollout, use approved representative photo fixtures to evaluate item/label accuracy, template validity, uncertainty reporting, and latency. Any independent reference counts are test labels, separate from staff capture.

Use the existing scripts and conventions in the implementation phase. `npm test` can skip DB tests without a test URL; require integration execution via CI or `npm run test:postgres` on a disposable cluster. Keep the repository's local-host/`student_cupboard_test` guards and isolate the upgrade fixture in its own disposable database run so other suites cannot migrate it first. Run typecheck and build as well. This planning task inspected tests without running them.

## 12. Step-by-step implementation sequence

Paths here are relative to `backend/`. Keep the evidence contract unavailable to pilot clients until all steps and compatibility checks pass.

| Step and dependency | Files and DB work | Backend work, tests and acceptance criteria |
| --- | --- | --- |
| 1. Add area/session persistence. No dependency. | `src/db/schema.ts`, next Drizzle migration and metadata. Create areas, sessions and manifest tables. | No route changes. Verify migration from `0002`, clean apply, unique names, FKs and existing row parity. This keeps the new tables inert and independently reviewable. |
| 2. Add scan provenance and observations. Depends on 1. | `src/db/schema.ts`, subsequent Drizzle migration and metadata, `tests/evidence-migration.integration.test.ts`. Extend scan schema; create observations and indexes. | Same review must include legacy mode narrowing in `src/services/scans.service.ts` and explicit DTO compatibility in `src/routes/scans.ts` as needed for type safety. Add migration/regression tests for constraints, original fingerprint behavior and unchanged ledger and API. No evidence upload path yet. |
| 3. Add canonical area lifecycle. Depends on 1. | New `inventory-areas` route, validator and service files, `src/app.ts`, evidence tests. No DB change. | Verify create/list/edit/archive/restore with auth, name uniqueness and stable IDs. Staff can select only active areas for a new manifest once sessions are enabled. |
| 4. Add session manifests and lifecycle. Depends on 2 and 3. | New `scan-sessions` route, validator and service, `src/app.ts`, evidence tests. No DB change. | Verify an atomic snapshot of every active area for full mode and one selected active area for individual mode. Test replay, registry changes, capture completeness and owner-only closure. Closed incomplete sessions retain the full manifest and successful observations. |
| 5. Validate the extraction contract. Depends on 2; can be reviewed alongside 3–4. | `src/validators/evidence-scans.ts`, `src/services/evidence-vision.service.ts`, `src/services/openai.service.ts`, `src/services/images.service.ts`, `tests/evidence.test.ts`. No DB change. | Verify ordered per-photo metadata and IDs, known and unknown capture times, separate server receipt time, structured prompt/schema, deduplication, source refs, uncertain quantities and safe errors with mocks. Confirm existing SDK and Sharp tests pass. |
| 6. Wire evidence upload and atomic persistence. Depends on 4 and 5. | `src/routes/scans.ts`, `src/app.ts`, `src/services/evidence-scans.service.ts`, observation insert mapping in `src/services/observations.service.ts`, evidence and legacy scan tests. No DB change. | Verify correct multipart dispatch, owner and manifest checks, idempotency, retries, close races, fenced claims, and atomic success/failure. Evidence and failures are visible in session detail. Verify closed incomplete captures preserve evidence and that uploads persist metadata only. DB snapshots verify no legacy stock writes. |
| 7. Add historical reads and release verification. Depends on 6. | `src/routes/observations.ts`, `src/validators/observations.ts`, `src/services/observations.service.ts`, `src/app.ts`, evidence tests, `docs/API.md`, `docs/INVENTORY_SCANNING.md`. No DB change. | Exercise full captures with complete and incomplete manifests and independent individual captures days apart. Verify source-photo provenance, batch ordering, unresolved observations, staff-wide history access, owner-only writes and empty results. Repeat stock/API regression and migration checks, document operational decisions and enable the pilot after compatible readers are deployed. |

If the two persistence steps ship as separate reviews, the first new migration is expected to be `0003` and the scan/observation migration `0004`, subject to intervening migrations. Keep existing numbered migrations intact.

## 13. Risks and unresolved decisions

| Decision or risk | Recommendation and implementation impact |
| --- | --- |
| Stable scope and legacy labels | Confirm the pilot's physical area list and boundaries with staff. A flat area register supports Phase 1. Approved legacy mappings are required only if older detection JSON must appear in the new history API. |
| Complete active-area registry and scale | Verify every pilot storage area is registered. Size snapshot inserts and manifest responses for expected site volume. If pagination is needed, keep the full manifest and compute completeness from all required areas, independent of paging. |
| Credential continuity | Staff-wide reads and creator-only writes are fixed. Confirm how stable staff IDs are managed through credential rotation. An interrupted session without its creator remains readable and a new capture can use a new session. |
| Pilot limits and proxy behavior | Proposed per-area and processing limits are five uploads per area, three attempts per batch, and a 120-second claim. Full sessions include every active area regardless of area count. Confirm throughput, HTTP proxy limits/timeouts and latency with the actual deployment. If synchronous requests prove unreliable, revisit transport and worker design within the transient-photo constraint. |
| Device capture time availability | Confirm which upload clients can supply device capture times, how they obtain them, and what to do with implausible clock skew. Treat missing values as unknown and keep server receipt separate. Bump the normalization version when image processing changes. |
| Structured evidence governance | Phase 1 keeps photos transient. Confirm provider and institutional policies and the structured evidence and metadata retention schedule. Visual comparison and photo reprocessing are future work. |
| Legacy stock drift | Existing manual mutations and scan area deltas can disagree. Keep this a known legacy risk and prevent any Phase 1 evidence processing from inheriting or trying to fix it. Future automatic initialization needs evidence of coherent scope, not reconstructed legacy allocations. |
| Duplicate or movement ambiguity | A repeated SKU or barcode can be two packages or one package seen twice. Keep the structured source references and hints. Choose thresholds, joint analysis and acceptance policies with representative evidence in later phases. |

## 14. Phase 1 completion checklist

- [ ] Versioned Drizzle migrations apply on a clean database and preserve legacy fixtures through upgrade.
- [ ] Canonical areas can be registered, selected, renamed and archived without losing history.
- [ ] An individual session records one active area. A full session freezes every active area at creation and excludes archived areas. Closing reports complete only after every required area has ready evidence. Incomplete closure preserves successful observations.
- [ ] Staff can capture and close sessions without counting stock, entering baselines, confirming items or reconciling inventory.
- [ ] All evidence scans belong to an intended session area; legacy scans retain their text and legacy review lifecycle.
- [ ] History returns immutable observations with explicit uncertainty, nullable product matches, and ordered source photo IDs. Each source photo has its own device-reported time or explicit unknown, with server upload time kept separately.
- [ ] Exact scoped replay, concurrency, claim expiry and transaction failures cannot create duplicate or partially persisted evidence.
- [ ] No evidence operation changes stock, product records, accepted area counts, nutrition or the stock ledger. Missing items and quantity changes create no stock or movement events.
- [ ] All authenticated staff can read observations and associated sessions and scans. Only the session creator can upload, retry or close. Viewer credentials stay forbidden and unrelated endpoint access stays as before.
- [ ] The capture path keeps actual photographs transient and retains structured evidence and metadata only. Provider handling, structured evidence retention and pilot processing limits are documented before rollout.
- [ ] Automated tests pass with disposable PostgreSQL and mocked vision. Backend typecheck and build pass.
