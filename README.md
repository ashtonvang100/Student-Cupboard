# Student Cupboard — combined local app

The frontend and backend run together against a private local PostgreSQL database.

- App: http://127.0.0.1:5173
- Backend: http://127.0.0.1:3000/api
- PostgreSQL: 127.0.0.1:55433 (isolated project cluster)

## Open and sign in

Open the app URL. Copy the contents of `.local/staff-token.txt` into the **Staff access token** field, then choose **Continue with staff access**. This token is for this local database only. Never commit or share it.

The database contains three clearly labeled sample products. These are actual local database records, not live Fresno State inventory. Their stock counts load through the real API. Shelf availability stays “Needs update” until supported shelf observations are available.

## Start and stop

On this Mac, double-click **Start Local App.command**. It starts PostgreSQL if needed, then the backend and frontend. Keep its Terminal window open. To stop everything, double-click **Stop Local App.command**. Data is preserved.

The app was initially started in the background. Use **Stop Local App.command** before starting a second copy. Background logs are in `.local/app.log`.

With Node.js 22+ and pnpm available:

```sh
pnpm install
pnpm setup
pnpm dev
```

Setup creates a new isolated cluster only inside this project's `.local/postgres` directory. It never resets an existing database. Credentials are randomly generated and saved in ignored, private local files. PostgreSQL 17 was installed with Homebrew on this Mac; `PG_BIN` can point to another PostgreSQL installation before initial setup.

## AI scanning

Set `OPENAI_API_KEY` in `backend/.env` to enable real photo analysis, then restart the app. Do not put it in the frontend. Without this key, catalog browsing and authentication work, while real scans report that the AI service is not configured. The backend has no chatbot endpoint, so live AI chat remains unavailable.

## Project layout

- `frontend/`: React + TypeScript UI and Vite development proxy.
- `backend/`: Hono API, Drizzle schema, migrations, and backend tests.
- `scripts/`: setup, start, stop, initial sample data, and connectivity verification.
- `.local/`: ignored database files, logs, staff token and process metadata.

Backend source: https://github.com/ashtonvang100/Student-Cupboard.git at commit `23685be10ddae2daf8b9278d36f5eac890e9e444`.

The existing `../student-cupboard` frontend and `../backend-reference` checkout are preserved. This combined local project does not change the hosted site.

## Verification

Both projects pass TypeScript checks. Frontend domain/transport tests and backend unit tests pass. The running frontend returns HTTP 200; its `/api` proxy reaches the database-backed health endpoint, rejects unauthenticated product requests with 401, and loads products, categories, inventory, and scan history with the local staff token.

Run `node scripts/verify.mjs` while the app is running to repeat these read-only connection checks. Backend database integration test suites are not run against the app's database; they require a separate `student_cupboard_test` database.
