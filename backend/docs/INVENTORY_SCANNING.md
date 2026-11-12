# AI inventory scanning

The existing Hono API remains under `/api` (there is no `/api/v1` alias). All product, category, inventory and scan routes now require `Authorization: Bearer <staff-token>`. `/` and `/api/health` remain public. Responses keep the existing `{ "data": ... }` / `{ "error": { "code", "message" } }` envelopes. Paginated lists use the existing `page`, `limit`, `pagination.hasMore` conventions.

## Configuration and startup

```sh
npm ci
# Edit your existing .env using .env.example; do not overwrite local credentials.
# Set OPENAI_API_KEY, OPENAI_VISION_MODEL, STAFF_API_TOKENS and local PG* or DATABASE_URL.
npm run db:migrate
npm run dev
```

`OPENAI_VISION_MODEL` defaults to `gpt-5-mini`. The official SDK uses Responses image inputs and Zod Structured Outputs. Reference: [image inputs](https://developers.openai.com/api/docs/guides/images-vision) and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Calls are server-side with a 90-second timeout, no automatic retries, and `store: false`. Do not place OpenAI credentials in frontend code. OpenAI still processes the images; `store: false` is not a promise of zero provider retention.

`STAFF_API_TOKENS` is a JSON array of per-person `{ "id", "role", "token" }` objects. Tokens must contain at least 32 characters; generate them using a cryptographic random generator. IDs are audit identities. Use `role: "staff"`; `viewer` credentials receive 403 for resource access. Missing credentials fail closed with 401. This is an initial server-managed authentication mechanism, not Fresno State SSO. Use HTTPS, distribute tokens privately, and rotate/revoke them by changing server configuration and restarting. Do not ship a shared deployment token in a public frontend bundle.

`DATABASE_URL` optionally overrides PG settings. Local use still requires database `student_cupboard`. Remote/RDS access is disabled unless `DATABASE_ALLOW_REMOTE=true` and `DATABASE_CA_CERT` contains the trusted CA PEM certificate. Remote TLS verifies certificates. URL query parameters are rejected to avoid conflicting SSL settings. This implementation was developed against disposable local PostgreSQL only; it has not contacted RDS. Review generated SQL before applying migrations with your deployment process.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/inventory/scans` | Analyze multipart images; requires UUID `Idempotency-Key` |
| GET | `/api/inventory/scans` | Paginated scan summaries |
| GET | `/api/inventory/scans/:scanId` | Original analysis, reviewed items, status and errors |
| PATCH | `/api/inventory/scans/:scanId/items/:itemId` | Correct, confirm or exclude an item |
| POST | `/api/inventory/scans/:scanId/approve` | Apply every included, confirmed item atomically |
| POST | `/api/inventory/scans/:scanId/reject` | Reject a pending scan without changing stock |
| GET | `/api/inventory` | Existing inventory list |
| GET | `/api/inventory/:id` | Existing inventory detail, plus `areas` with counts and expiry |
| GET | `/api/inventory/:id/history` | Alias for existing `/transactions` history |
| GET | `/api/products/:id` | Product detail, including separate `aiNutrition` candidate |

All scan and item IDs are UUIDs; existing product, category and inventory IDs remain integers. Product create/PATCH also accepts nullable `packageSize` and `variation`. Scan POST returns 201, or 202 for an already processing scan. Analysis is synchronous; configure the HTTP proxy timeout above 90 seconds. Scan results use `pending_review`, not `completed`, until approved or rejected. Scan history includes actor ID and error code; detail includes original structured analysis and mutable review items. No images/base64 are stored in PostgreSQL or on disk.

## Upload and review example

```sh
export STAFF_TOKEN='<your personal staff token>'
# Use a new UUID for each distinct upload. Reuse that UUID when retrying a lost request.
curl -X POST http://127.0.0.1:3000/api/inventory/scans \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H 'Idempotency-Key: 1e486898-b074-490b-bf5e-f70cc2e46466' \
  -F 'area=pantry-shelf-a' \
  -F 'images=@shelf.jpg' -F 'images=@nutrition-label.jpg'
```

Upload one to five JPEG, PNG or WebP files using repeated `images` fields and exactly one nonempty `area`. Limits: 8 MiB per file, 24 MiB combined, 26 MiB multipart body, 40 million decoded pixels per image. The decoder checks the actual image format, rejects animated/multipage images, applies orientation, and scales to at most 2400 pixels per side. Normalization reduces payload size but may reduce tiny label readability; take close-up label photos. Exact normalized duplicate images in a session are collapsed. Other JSON endpoints retain the 64 KiB body limit.

A response has this abbreviated shape (the actual nutrition schema includes all supported nutrient fields):

```json
{
  "data": {
    "id": "3ed3d2d1-f161-4076-8c25-7ced5b57751e",
    "status": "pending_review",
    "area": "pantry-shelf-a",
    "analysis": { "items": [], "warnings": [] },
    "items": [{
      "id": "89998eed-d708-4cf1-9969-6decdcb07126",
      "productName": "Cheerios", "brand": "General Mills",
      "packageSize": "18 oz", "variation": "Original",
      "quantity": 12, "unit": "boxes", "quantityKind": "visible_count",
      "confidence": 0.95, "quantityConfidence": 0.95,
      "needsReview": false, "confirmed": false, "excluded": false,
      "productId": 10, "isNewProduct": false,
      "initialAreaQuantity": null, "nutrition": null, "expirationDate": null
    }]
  }
}
```

Review each included item, even if `needsReview` is false. Confirm the identity, count, and unit; estimates always need staff review. Match suggestions require a unique normalized name, brand, package size and variation; ambiguous records stay unmatched. Staff can select `productId` explicitly. The API treats this selection as an explicit identity correction; changing identity clears extracted nutrition and barcode rather than attaching the old label to a different product.

```sh
curl -X PATCH http://127.0.0.1:3000/api/inventory/scans/SCAN_UUID/items/ITEM_UUID \
  -H "Authorization: Bearer $STAFF_TOKEN" -H 'Content-Type: application/json' \
  -d '{"productId":10,"quantity":12,"unit":"boxes","initialAreaQuantity":10,"confirmed":true}'

curl -X POST http://127.0.0.1:3000/api/inventory/scans/SCAN_UUID/approve \
  -H "Authorization: Bearer $STAFF_TOKEN"
```

Replace `SCAN_UUID` and `ITEM_UUID` with returned IDs. PATCH requires `confirmed`; set it false while an item is still being corrected. `{ "excluded": true, "confirmed": false }` excludes an incorrect detection. A new product requires `{ "isNewProduct": true, "productId": null, "productName": "...", "categoryId": 1, "quantity": 3, "unit": "boxes", "confirmed": true }`. Category must already exist. Distinct product sizes/variations remain separate products. Multiple included rows targeting the same product must be combined into one reviewed count and the extras excluded; this is not a lot-level counting system.

## How area reconciliation protects stock

Use stable, non-overlapping area names. Names are trimmed and lowercased. A scan only changes included products in its named area. Missing or excluded products do not imply zero stock. To deliberately count an area as empty for a product, review its quantity as zero.

For an area's first count, `initialAreaQuantity` means **how many units from that area are already included in the current inventory total**. Staff must supply it for existing products. Example: total stock is 100, ten of those units were recorded for shelf A, and the photo shows twelve. Set initialAreaQuantity to 10; approval adds two and total becomes 102. Use zero only when these are newly received units not yet recorded. New products start at zero automatically.

Later scans use the previous approved count for that product/area. A new shelf A count of seven changes stock by 7 − 12 = −5, leaving all other stock intact. Do not give overlapping shelves different area names. Do not record the same delivery through both scanning and a manual addition. Manual removals do not update area baselines: if stock has moved between areas or a baseline exceeds remaining total stock, reconcile the physical area and current total before scanning again.

Approval uses one database transaction for product creation, stock, area count/expiry, optional nutrition candidate, history, and status. Row locks and a database advisory lock serialize competing approvals. A repeat approval returns the existing approved result. Counts taken before another stock change or newer area approval are rejected; take new photos. Rejecting/editing an approved or rejected scan is prohibited. History records actor, scan, previous/new quantity, delta and timestamp; unchanged quantities create no stock transaction.

The upload key is unique per actor, and a normalized image-set fingerprint prevents the same images being submitted again under a different key or area. Reusing a key for different content returns 409. Failed/rejected scans remain recorded, and identical images are not reprocessed: take new photos to retry. A process crash can leave a scan `processing`; there is no background worker/recovery service yet. Inspect those records operationally; do not assume they completed. Different photos of overlapping inventory still require staff review and consistent area naming.

## Nutrition and expiry

Zod validates serving size, calories, total/saturated/trans fat (g), cholesterol/sodium (mg), carbohydrates/fiber/total and added sugars/protein (g), micronutrients with units, ingredients, allergens, source and confidence. Unknown fields are null. Nutrition is per serving for the specific size/variation. Missing allergen/ingredient text is not proof that a product is allergen-free. The AI instructions prioritize visible labels and permit clearly marked estimates only for identifiable unlabeled foods; staff must verify its interpretation.

`product_nutrition` stores AI data separately from quantity. AI candidates have `verified: false`, even when the source is `product_label`; staff approving stock does not certify nutrition. An existing profile or legacy `products.nutrition` is never replaced by scanning, so verified or manual information survives lower-confidence results. Existing manual nutrition remains available through the original product API. No external nutrition service is used. Nutrition verification/promotion is a future dedicated workflow. `GET /api/products/:id` exposes the candidate and provenance for display.

Readable full expiry dates are retained in original analysis and review items and saved with the approved area count. Ambiguous dates remain null. One area/product count supports one reviewed expiry date; multiple lot dates remain review evidence and require a future lot model for detailed tracking.

## Errors and local verification

Authentication: 401/403. Validation: 400. Unsupported type: 415. Oversized request/image: 413. Review or idempotency conflicts: 409. OpenAI rate limit: 429. Malformed/refused/incomplete AI output and other upstream errors: 502. Missing key: 503. OpenAI timeout: 504. Internal/provider details and credentials are not returned. Failed scans store a safe error code. After a network timeout, retrieve scan history/results before trying a fresh upload.

```sh
npm test                   # mocked OpenAI; DB tests skipped without TEST_DATABASE_URL
npm run typecheck
npm run build
npm run test:postgres       # all tests, disposable local PostgreSQL cluster
# Or provision a separate local student_cupboard_test and set TEST_DATABASE_URL:
npm run test:integration
```

Tests never require production RDS or a real API key. They cover upload decoding/limits, exact SDK request shape, malformed/error/timeout responses, matching, nullable nutrition, authorization, first counts, area deltas, new products, exclusions, stale/concurrent approvals, preservation of nutrition, and database rollback. No lint script exists. To manually test real AI, configure your key locally and use the curl flow above; this incurs API usage. Automated verification does not establish real model performance or RDS deployment readiness.

## Changed files

- `src/db/schema.ts`, `drizzle/0001_ai_inventory_scanning.sql`, `drizzle/0002_area_expiration.sql`, `drizzle/meta/0001_snapshot.json`, `drizzle/meta/0002_snapshot.json`, `drizzle/meta/_journal.json`: additive table/column definitions and generated migration state.
- `src/services/openai.service.ts`, `src/services/images.service.ts`, `src/validators/scans.ts`: new SDK adapter, memory-only image preparation, shared scan types and Zod validation.
- `src/services/scans.service.ts`, `src/routes/scans.ts`: new scan persistence, matching, review, approval and reconciliation modules.
- `src/middleware/auth.ts`: new per-person staff authentication/authorization middleware. `src/middleware/error-handler.ts` adds safe authentication and upstream error statuses.
- `src/app.ts`, `src/index.ts`: authentication, upload-specific limits, scan route registration and startup message.
- `src/config.ts`: optional URL configuration and explicit verified-TLS remote opt-in.
- `src/validators/products.ts`, `src/services/products.service.ts`: package/variation fields and separate nutrition candidate retrieval.
- `src/routes/inventory.ts`, `src/services/inventory.service.ts`: history alias, area detail, and authenticated actor/quantity audit fields.
- `tests/api.integration.test.ts`, `tests/validation.test.ts`: existing tests now supply explicit test staff credentials.
- `tests/scan-fixtures.ts`, `tests/scans.test.ts`, `tests/scans.integration.test.ts`: new deterministic analysis fixtures, mocked SDK/upload/auth tests, and database workflow tests.
- `../.github/workflows/backend-ci.yml`: disposable PostgreSQL service for CI. `package.json`, `package-lock.json`: OpenAI/Zod/Sharp dependencies and sequential integration test discovery.
- `.env.example`, `README.md`, `docs/API.md`, `docs/INVENTORY_SCANNING.md`: configuration, architecture, API examples, workflow rules, test instructions and limitations.
