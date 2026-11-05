# Student Cupboard REST API

Local base URL: `http://127.0.0.1:3000/api`. Bodies and responses use JSON. Send `Content-Type: application/json` for POST/PATCH. Maximum request body size: 64 KiB.

## Access and production readiness

Authentication is not implemented. All category, product, inventory, and history endpoints require authenticated, authorized pantry staff before production. Read endpoints require inventory read permission; category/product writes and inventory unit/threshold changes require management permission; stock transactions and quantity changes require stock-write permission. These are requirements to implement with the institution's approved identity system, not currently enforced roles. Health may be exposed to infrastructure health checks with an approved network policy. Never expose this development API publicly. Cross-origin access is not enabled; use a local development proxy or implement an explicit origin allowlist after frontend origins are agreed.

## Common conventions

IDs are positive integer numbers (1–2,147,483,647); use their string representation in paths. `:id` under `/inventory` always refers to **inventory.id**, not product ID. Use `productId` in inventory responses to associate products. Fields use camelCase. Timestamps are ISO 8601 strings. Unknown body fields are rejected; PATCH requires at least one supported field. Omitted fields remain unchanged. Nullable fields can be cleared with `null`; empty strings are rejected. Nutrition PATCH replaces the whole nutrition object.

Success responses use `{ "data": ... }`. Collection endpoints accept `page` (positive integer, default 1, maximum 1,000,000) and `limit` (1–100, default 20). Unknown and repeated collection query parameters are rejected. Results are ordered by ID ascending, except transaction history which uses ID descending (newest first). Offset pagination may shift when data changes; there is no total count.

```json
{
  "data": [{ "id": 1, "name": "Grains", "description": null, "createdAt": "2026-11-05T12:00:00.000Z", "updatedAt": "2026-11-05T12:00:00.000Z" }],
  "pagination": { "page": 1, "limit": 20, "hasMore": false }
}
```

## Endpoints

| Method | Path | Input | Success |
|---|---|---|---|
| GET | `/health` | None | 200 connectivity result; 503 when database is unavailable |
| GET | `/categories` | `page`, `limit` | 200 category collection |
| GET | `/categories/:id` | Category ID | 200 category |
| POST | `/categories` | Category creation body | 201 category; `Location` header |
| PATCH | `/categories/:id` | Category ID, category patch body | 200 updated category |
| GET | `/products` | `page`, `limit` | 200 product collection |
| GET | `/products/:id` | Product ID | 200 product |
| POST | `/products` | Product creation body | 201 product; `Location` header; zero-stock inventory also created |
| PATCH | `/products/:id` | Product ID, product patch body | 200 updated product |
| GET | `/inventory` | `page`, `limit` | 200 inventory collection |
| GET | `/inventory/:id` | Inventory ID | 200 inventory record |
| PATCH | `/inventory/:id` | Inventory ID, inventory patch body | 200 updated inventory record |
| GET | `/inventory/:id/transactions` | Inventory ID; `page`, `limit` | 200 transaction collection |
| POST | `/inventory/:id/transactions` | Inventory ID, transaction body | 201 transaction; inventory quantity updated atomically |

The preserved starter `GET /` returns plain text `Hello Hono!` outside the API namespace. There are no deletion endpoints or history modification endpoints.

## Health

`GET /health` executes `SELECT 1`; a running API with an unavailable database returns 503. This checks connectivity, not migration readiness. Response caching is disabled.

```json
{ "data": { "status": "ok", "database": "connected" } }
```

## Categories

| Field | Type | POST | PATCH |
|---|---|---|---|
| `name` | trimmed nonempty string, max 120 | Required, case-insensitive unique | Optional |
| `description` | trimmed nonempty string, max 4000, or null | Optional, default null | Optional |

```http
POST /api/categories
Content-Type: application/json

{"name":"Grains","description":"Rice, oats, and pasta"}
```

```json
{ "data": { "id": 1, "name": "Grains", "description": "Rice, oats, and pasta", "createdAt": "2026-11-05T12:00:00.000Z", "updatedAt": "2026-11-05T12:00:00.000Z" } }
```

Example PATCH body: `{ "description": null }`. GET detail returns the same record shape. Duplicate names return 409.

## Products

| Field | Type | POST | PATCH |
|---|---|---|---|
| `name` | trimmed nonempty string, max 200 | Required | Optional |
| `categoryId` | positive integer, existing category | Required | Optional |
| `brand` | trimmed nonempty string, max 200, or null | Optional | Optional |
| `barcode` | trimmed nonempty string, max 100, or null | Optional, unique when present | Optional |
| `description` | trimmed nonempty string, max 4000, or null | Optional | Optional |
| `nutrition` | object described below, or null | Optional | Optional, replaces object |

All omitted optional fields default to null. Product quantity is managed through inventory, never through product requests. Barcodes are strings so leading zeros survive.

Nutrition fields are optional. `servingSize` is a trimmed nonempty string, max 100 characters. `calories`, `totalFatGrams`, `sodiumMilligrams`, `totalCarbohydrateGrams`, and `proteinGrams` are finite numbers between 0 and 1,000,000; decimals are allowed. Additional nutrition keys are rejected. Numbers describe the stated serving size; no automatic nutrient conversion is performed.

```http
POST /api/products
Content-Type: application/json

{"name":"Brown Rice","brand":"Example Brand","barcode":"001234567890","categoryId":1,"nutrition":{"servingSize":"45 g dry","calories":160,"totalFatGrams":1.5,"sodiumMilligrams":0,"totalCarbohydrateGrams":34,"proteinGrams":3}}
```

```json
{
  "data": {
    "id": 10,
    "name": "Brown Rice",
    "brand": "Example Brand",
    "barcode": "001234567890",
    "description": null,
    "categoryId": 1,
    "nutrition": { "servingSize": "45 g dry", "calories": 160, "totalFatGrams": 1.5, "sodiumMilligrams": 0, "totalCarbohydrateGrams": 34, "proteinGrams": 3 },
    "createdAt": "2026-11-05T12:00:00.000Z",
    "updatedAt": "2026-11-05T12:00:00.000Z"
  }
}
```

Example PATCH body: `{ "brand": "New Brand", "barcode": null }`. GET detail returns the same record shape. A nonexistent category returns 409 `INVALID_REFERENCE`. Duplicate barcodes return 409 `CONFLICT`.

## Inventory

The API creates one row automatically for each new product with quantity 0, unit `each`, and threshold 0. There is no manual inventory creation endpoint. GET returns:

```json
{ "data": { "id": 7, "productId": 10, "quantity": 12, "unit": "each", "lowStockThreshold": 5, "updatedAt": "2026-11-05T12:00:00.000Z" } }
```

PATCH fields:

| Field | Type | Behavior |
|---|---|---|
| `quantity` | integer 0–2,147,483,647 | Absolute stock count; requires reason |
| `reason` | trimmed nonempty string, max 4000 | Required with quantity, rejected without quantity |
| `unit` | trimmed nonempty string, max 50 | May change only when current quantity is zero |
| `lowStockThreshold` | integer 0–2,147,483,647 | Alert threshold; no automatic alerts yet |

```http
PATCH /api/inventory/7
Content-Type: application/json

{"quantity":15,"reason":"Physical stock count","lowStockThreshold":5}
```

Response: the updated inventory record in `{ "data": ... }`. A real quantity change creates an `adjustment` history row containing the delta; unchanged quantity creates no history. Metadata-only patches create no quantity transaction. Quantity and history changes are atomic. Unit changes do not convert quantities and require zero current stock even when the request also sets quantity to zero.

## Inventory transactions

| Field | Type | Required |
|---|---|---|
| `transactionType` | `"addition"`, `"removal"`, or `"adjustment"` | Yes |
| `quantityChange` | nonzero integer −2,147,483,647 through 2,147,483,647 | Yes |
| `reason` | trimmed nonempty string, max 4000 | Yes |

`addition` requires a positive delta; `removal` requires a negative delta; `adjustment` allows either sign. All deltas must leave quantity within the valid stock range. History is append-only through this API. A failed request changes neither quantity nor history.

```http
POST /api/inventory/7/transactions
Content-Type: application/json

{"transactionType":"removal","quantityChange":-2,"reason":"Pantry distribution"}
```

```json
{ "data": { "id": 42, "productId": 10, "transactionType": "removal", "quantityChange": -2, "reason": "Pantry distribution", "createdAt": "2026-11-05T12:00:00.000Z" } }
```

GET history returns these records in the collection envelope, newest ID first. A nonexistent inventory ID returns 404, while an existing row with no history returns an empty collection. Read inventory again to obtain its updated quantity. Requests are not idempotent: retrying a transaction POST can apply it twice. Do not automatically retry without an agreed idempotency mechanism.

## Errors

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "The change would make inventory negative" } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid ID, query, fields, data types, malformed JSON, missing required fields, or negative absolute quantity |
| 400 | `INVALID_VALUE` | Database check or numeric constraint rejected the value |
| 404 | `NOT_FOUND` | Record or route does not exist |
| 409 | `CONFLICT` | Category name or barcode already exists |
| 409 | `INVALID_REFERENCE` | Referenced category/product does not exist |
| 409 | `INSUFFICIENT_STOCK` | Delta would make quantity negative |
| 409 | `QUANTITY_LIMIT` | Delta would overflow maximum quantity |
| 409 | `UNIT_IN_USE` | Cannot change the unit of nonzero stock |
| 413 | `BODY_TOO_LARGE` | Body exceeds 64 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | POST/PATCH requires application/json |
| 500 | `INTERNAL_ERROR` | Unexpected error; internal SQL and credentials are hidden |
| 503 | `DATABASE_UNAVAILABLE` | Health endpoint could not query PostgreSQL |

## React / TypeScript consumption

```ts
type ApiError = { error: { code: string; message: string } }
type ItemResponse<T> = { data: T }
type CollectionResponse<T> = {
  data: T[]
  pagination: { page: number; limit: number; hasMore: boolean }
}
type Inventory = {
  id: number
  productId: number
  quantity: number
  unit: string
  lowStockThreshold: number
  updatedAt: string
}

// With a local frontend proxy forwarding /api to the backend:
const response = await fetch('/api/inventory?page=1&limit=20')
if (!response.ok) {
  const failure = await response.json() as ApiError
  throw new Error(failure.error.message)
}
const result = await response.json() as CollectionResponse<Inventory>
```

Dates remain strings until explicitly parsed by the frontend. Check `response.ok` before using success data.
