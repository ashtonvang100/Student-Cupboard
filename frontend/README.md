# Student Cupboard frontend

A React + TypeScript frontend based on the provided mobile Figma reference, with responsive desktop navigation. The existing backend is not modified.

## Run locally

Requires Node.js 22 or newer and npm or pnpm.

```sh
npm install
npm run dev
```

Open the URL printed by Vite. The default is a clearly labeled demo with sample inventory. Profile → View welcome screen opens the welcome/sign-in concept.

```sh
npm run build
npm test
npm run preview
```

## Connect the existing local backend

1. Start your existing backend at `http://127.0.0.1:3000` using its own setup instructions.
2. Open Profile → Connect your backend and enter `/api` as the address, or configure `/api` in `public/config.js`.
3. Run `npm run dev`. Vite proxies `/api` to port 3000 without removing the prefix.
4. Enter your privately issued staff token in the connection form or welcome screen. It stays in React memory, never in local storage, source, or configuration. Reloading clears it.

The frontend fetches all pages of `/products`, `/categories`, and `/inventory` using `limit=100` and `pagination.hasMore`. It joins `inventory.productId` to `product.id` and categories by `categoryId`. Inventory IDs are retained separately. Search and category filtering apply across the loaded catalog. These independent paginated reads are not an atomic snapshot.

The API adapter honors `{data, pagination}` envelopes and 401/403 failures. Missing nutrition stays unknown, rather than becoming zero. No stock-writing endpoints or automatic retries are used.

## Production configuration

Use an approved HTTPS API base URL **including `/api`**, such as `https://backend.example.edu/api`, in `public/config.js`, then rebuild. Configure the backend's CORS allowlist for the exact frontend origin. The local Vite proxy is development-only and is not included in the published static app. The hosted demo cannot connect to a backend running on your laptop.

Never put database credentials, an OpenAI key, or staff tokens into `config.js`. No SSO, Google/Apple login, or public student API exists in the supplied contract; those buttons are not presented as functioning login options.

## Included

- Responsive home, category browsing, search, item details and nutrition.
- Favorites and recent viewing history stored on this device.
- Distinct available, unavailable, and needs-update labels.
- FoodGenie chat interface with explicitly labeled, fixed sample responses.
- Staff photo selection, file-limit validation, live scan review, history and approval gating.
- Backend health check and staff-authenticated catalog integration.
- Tests for stale observations, upload limits, mandatory review, and correct resource joins.

## Deliberate integration boundaries

- **Chat:** The supplied backend contract has no chatbot endpoint. Demo responses are fixed examples, not AI or personalized nutritional advice.
- **Scanning:** Live uploads, paginated history, review, approval and rejection match `backend/docs/INVENTORY_SCANNING.md` in the linked repository. Uploads send repeated `images` fields, one `area`, and a UUID `Idempotency-Key`; a 120-second client timeout accommodates analysis. Lost uploads retain the same key for an explicit same-upload retry. Unknown write outcomes block further edits until refresh. Review supports existing/new product selection, category, integer counts, units, first-area baselines, expiration dates, and exclusions. Approval is explicit and refreshes catalog data. No automatic write retries are used.
- **Freshness:** `inventory.updatedAt` can represent a metadata change, not a shelf photograph. Live catalog items therefore show “Needs update” until a trusted shelf-observation timestamp is supplied. Recorded quantity and inventory edit time are shown separately. Demo observations use a provisional 24-hour threshold; confirm the actual freshness policy with staff.
- **Images:** The product contract has no photo URL. Live items use a neutral “Photo not available” graphic rather than unrelated food photos. Demo photos are representative Unsplash images and require internet access, with a local fallback.
- **Nutrition provenance:** Only the product's `nutrition` is used. Unverified `aiNutrition` suggestions are not promoted to verified values. A dash means a nutrient was not recorded.
- **Notifications:** Empty state only; there is no notification endpoint.
- **PWA:** This delivery is a responsive web frontend. Offline inventory, push notifications, and installability are not enabled; offline behavior must not misrepresent stock freshness.

## Structure

- `src/main.tsx`: screens and interactions.
- `src/api.ts` and `src/transport.mjs`: staff authentication, API errors, pagination, resource loading and scan calls.
- `src/Connection.tsx`: session-only connection form, health and authenticated catalog verification.
- `src/LiveScan.tsx`: live scan workflow.
- `src/domain.mjs`: resource mapping, freshness, upload/review validation.
- `src/data.ts`: demo data and frontend types.
- `public/styles.css`: responsive design.
- `public/config.js`: public backend connection settings.
- `vite.config.ts`: local backend proxy.
- `tests/domain.test.mjs`: data-safety regression checks.

## Verification

Production build and TypeScript validation passed. All 10 domain and mocked-transport tests passed. Browser checks cover mobile search, nutrition details, saved favorites, and sample chat. Live backend requests cannot be verified until the backend is available.

## Backend source inspected

Repository: https://github.com/ashtonvang100/Student-Cupboard.git

Commit: `23685be10ddae2daf8b9278d36f5eac890e9e444`. A local, unchanged checkout is at `../backend-reference/backend`. The repository is code, not a hosted service. No backend was running and no configured database or staff credentials were available; live end-to-end verification remains pending. No databases or credentials were created or modified.

To make it live, the backend owner must provide the existing PostgreSQL connection, configure per-person staff tokens, review/apply the repository migrations against the intended database, and start/deploy the backend. AI scans additionally need its server-side OpenAI key. For the published frontend, deploy an HTTPS API and configure its CORS allowlist (including Authorization, Content-Type and Idempotency-Key request headers, GET/POST/PATCH/OPTIONS methods) for the published site origin. The source currently does not enable CORS. Then use Profile → Connect your backend.
