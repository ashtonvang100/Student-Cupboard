# Student Cupboard REST API

Local base URL: `http://127.0.0.1:3000/api`. Bodies and responses use JSON. Send `Content-Type: application/json` for POST/PATCH. Maximum request body size: 64 KiB.

This reference describes the routes currently implemented in `src/routes/`, their validators, and service behavior. Example IDs and timestamps are illustrative; use IDs returned by your own backend.

- [Frontend setup](#frontend-setup)
- [Common conventions](#common-conventions)
- [Endpoint overview](#endpoints)
- [Categories](#categories)
- [Products](#products)
- [Inventory](#inventory)
- [Inventory transactions](#inventory-transactions)
- [Errors](#errors)
- [TypeScript types and request helper](#typescript-types-and-request-helper)
- [Frontend workflows](#frontend-workflows)

## Frontend setup

Start the backend using the [repository setup instructions](../README.md#local-setup). The default origin is `http://127.0.0.1:3000`; `HOST` and `PORT` can override it. Check connectivity with:

```sh
curl http://127.0.0.1:3000/api/health
```

Use `/api` as the frontend base path with a development proxy. For example, merge this into a Vite frontend's existing configuration (Vite is not installed in this backend repository):

```ts
// vite.config.ts in the frontend project
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
})
```

Keep the `/api` prefix; no rewrite is needed. Call `fetch('/api/products')` from the browser. A direct request from another origin, such as a frontend on port 5173, requires backend CORS configuration that is not currently present. The development proxy does not configure production routing.

No login endpoint, bearer token, cookie session, or current-user endpoint exists yet. Frontend requests currently need no authentication headers. Database credentials belong only in the backend environment.

## Access and production readiness

Authentication is not implemented. All category, product, inventory, and history endpoints require authenticated, authorized pantry staff before production. Read endpoints require inventory read permission; category/product writes and inventory unit/threshold changes require management permission; stock transactions and quantity changes require stock-write permission. These are requirements to implement with the institution's approved identity system, not currently enforced roles. Health may be exposed to infrastructure health checks with an approved network policy. Never expose this development API publicly. Cross-origin access is not enabled; use a local development proxy or implement an explicit origin allowlist after frontend origins are agreed.

## Common conventions

IDs are positive integer numbers (1–2,147,483,647); use their string representation in paths. `:id` under `/inventory` always refers to **inventory.id**, not product ID. Use `productId` in inventory responses to associate products. Fields use camelCase. Timestamps are ISO 8601 strings. Unknown body fields are rejected; PATCH requires at least one supported field. Omitted fields remain unchanged. Nullable fields can be cleared with `null`; empty strings are rejected. Nutrition PATCH replaces the whole nutrition object.

Success responses use `{ "data": ... }`. Collection endpoints accept `page` (positive integer, default 1, maximum 1,000,000) and `limit` (1–100, default 20). Unknown and repeated collection query parameters are rejected. Results are ordered by ID ascending, except transaction history which uses ID descending (newest first). Offset pagination may shift when data changes; there is no total count.

Only `page` and `limit` are supported on collections: there is no server-side search, category/product filtering, sorting parameter, or low-stock filter. Filtering one page in the browser filters only that page. Use `pagination.hasMore` to enable the next-page action; an empty result is successful and returns `data: []` with `hasMore: false`. Do not calculate a total page count from this response.

Send numeric body fields as JSON numbers, not strings from form inputs. Read-only fields such as `id`, `createdAt`, and `updatedAt` must be excluded from mutation bodies. An empty PATCH object is invalid. Optional does not mean nullable: only fields explicitly documented as nullable accept `null`.

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

## TypeScript types and request helper

These are wire types for frontend use. Dates stay strings until explicitly parsed. The generic helper assumes the backend's documented JSON envelope; TypeScript types do not perform runtime response validation.

```ts
type ApiError = { error: { code: string; message: string } }
type ItemResponse<T> = { data: T }
type CollectionResponse<T> = {
  data: T[]
  pagination: { page: number; limit: number; hasMore: boolean }
}
type Category = {
  id: number
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}
type Nutrition = {
  servingSize?: string
  calories?: number
  totalFatGrams?: number
  sodiumMilligrams?: number
  totalCarbohydrateGrams?: number
  proteinGrams?: number
}
type Product = {
  id: number
  name: string
  categoryId: number
  brand: string | null
  barcode: string | null
  description: string | null
  nutrition: Nutrition | null
  createdAt: string
  updatedAt: string
}
type Inventory = {
  id: number
  productId: number
  quantity: number
  unit: string
  lowStockThreshold: number
  updatedAt: string
}
type InventoryTransaction = {
  id: number
  productId: number
  transactionType: 'addition' | 'removal' | 'adjustment'
  quantityChange: number
  reason: string
  createdAt: string
}
type CreateCategory = { name: string; description?: string | null }
type PatchCategory = Partial<CreateCategory>
type CreateProduct = {
  name: string
  categoryId: number
  brand?: string | null
  barcode?: string | null
  description?: string | null
  nutrition?: Nutrition | null
}
type PatchProduct = Partial<CreateProduct>
type PatchInventory = {
  unit?: string
  lowStockThreshold?: number
} & (
  | { quantity: number; reason: string }
  | { quantity?: never; reason?: never }
)
type CreateTransaction = Pick<
  InventoryTransaction, 'transactionType' | 'quantityChange' | 'reason'
>

class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

// path starts with "/" and is relative to /api, e.g. "/products".
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body !== undefined && init.body !== null) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`/api${path}`, { ...init, headers })
  // A proxy may return an HTML or empty error response.
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const failure = payload as ApiError | null
    throw new ApiRequestError(
      response.status,
      failure?.error?.code ?? 'HTTP_ERROR',
      failure?.error?.message ?? `Request failed (${response.status})`,
    )
  }
  if (payload === null) throw new Error('Expected a JSON API response')
  return payload as T
}

const result = await api<CollectionResponse<Inventory>>(
  '/inventory?page=1&limit=20',
)
```

PATCH types still require the validation rules above, including at least one field. Transaction signs and numeric limits also need validation. Network failures and aborted requests reject `fetch` without an HTTP response; handle these separately from `ApiRequestError`. This helper never retries requests.

## Frontend workflows

### Load an inventory screen

Products, categories, and inventory are separate resources; responses do not embed related records. Join `inventory.productId` to `product.id` and `product.categoryId` to `category.id` in the UI. Product IDs and inventory IDs must not be treated as interchangeable.

To build complete lookup maps for a small inventory, fetch every page of each resource:

```ts
async function allPages<T>(path: string): Promise<T[]> {
  const rows: T[] = []
  let page = 1
  while (true) {
    const result = await api<CollectionResponse<T>>(`${path}?page=${page}&limit=100`)
    rows.push(...result.data)
    if (!result.pagination.hasMore) return rows
    page += 1
  }
}

const [products, categories, inventory] = await Promise.all([
  allPages<Product>('/products'),
  allPages<Category>('/categories'),
  allPages<Inventory>('/inventory'),
])
const productsById = new Map(products.map((product) => [product.id, product]))
const categoriesById = new Map(categories.map((category) => [category.id, category]))

const displayRows = inventory.map((stock) => {
  const product = productsById.get(stock.productId)
  return {
    ...stock,
    productName: product?.name ?? 'Unknown product',
    categoryName: product
      ? categoriesById.get(product.categoryId)?.name ?? 'Unknown category'
      : 'Unknown category',
  }
})
```

The `allPages` helper takes a resource path with no query string. Multi-page and multi-resource reads are not a consistent snapshot; records may change while loading. For larger catalogs, use paginated screens and agree on backend filtering/lookup endpoints before loading every record. No low-stock boolean or alert is returned; the UI must choose how to display `quantity` relative to `lowStockThreshold`.

### Create a product and receive stock

1. Load categories and submit an existing numeric `categoryId` with the product form.
2. `POST /products` returns the product and creates inventory at quantity zero. It does not return the inventory ID.
3. Load inventory pages and find the row whose `productId` matches the created product ID. There is no inventory lookup-by-product endpoint or `productId` query filter.
4. Use that row's `id` to post an `addition` transaction for the received stock.

```ts
// categoryId comes from the category selector; inventoryId from the lookup above.
async function createProduct(categoryId: number) {
  return api<ItemResponse<Product>>('/products', {
    method: 'POST',
    body: JSON.stringify({ name: 'Brown Rice', categoryId } satisfies CreateProduct),
  })
}

async function receiveStock(inventoryId: number) {
  const transaction = await api<ItemResponse<InventoryTransaction>>(
    `/inventory/${inventoryId}/transactions`,
    {
      method: 'POST',
      body: JSON.stringify({
        transactionType: 'addition',
        quantityChange: 12,
        reason: 'Donation received',
      } satisfies CreateTransaction),
    },
  )
  const stock = await api<ItemResponse<Inventory>>(`/inventory/${inventoryId}`)
  return { transaction: transaction.data, stock: stock.data }
}
```

### Update stock and refresh the UI

Use a signed transaction for receiving or distributing stock. Use inventory PATCH with `quantity` and `reason` for an absolute physical count. PATCH overwrites the count observed by the server at execution time; there is no version field or conditional-update mechanism to detect a stale form. Nutrition PATCH similarly replaces the complete nutrition object, so send all fields you intend to retain.

After a successful stock write, refresh the inventory detail/list and transaction history used by the screen. A transaction POST returns the transaction only; inventory PATCH returns the updated inventory row. Disable the submit action while a write is pending to reduce duplicate submissions.

For `INSUFFICIENT_STOCK`, `QUANTITY_LIMIT`, or `UNIT_IN_USE`, refresh inventory and show the returned message. For `CONFLICT`, ask the user to correct the duplicate name/barcode; for `INVALID_REFERENCE`, reload category choices. Errors contain one code/message pair, with no per-field error map.

If a write times out or loses its connection, the server may already have committed it. Re-read inventory/history and reconcile before resubmitting. There are no idempotency keys; automatic retries can duplicate products or stock transactions, and replaying an absolute count can overwrite intervening stock changes.
