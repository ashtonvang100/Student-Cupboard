import test from "node:test";
import assert from "node:assert/strict";
import { apiRequest, collectPages } from "../src/transport.mjs";
const ok = (data) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
test("collection loading follows hasMore and preserves all pages", async () => {
  const paths = [];
  const rows = await collectPages(async (path) => {
    paths.push(path);
    return {
      data: [{ id: paths.length }],
      pagination: { hasMore: paths.length < 2 },
    };
  }, "/products");
  assert.deepEqual(paths, [
    "/products?page=1&limit=100",
    "/products?page=2&limit=100",
  ]);
  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }]);
});
test("requests preserve /api and use staff bearer authentication", async () => {
  await apiRequest("/api", "/products?page=1&limit=100", "test-token", {
    origin: "http://localhost:5173",
    fetchImpl: async (url, init) => {
      assert.equal(url, "http://localhost:5173/api/products?page=1&limit=100");
      assert.equal(init.headers.Authorization, "Bearer test-token");
      assert.equal(init.redirect, "error");
      return ok({ data: [] });
    },
  });
});
test("multipart scan sends idempotency header and leaves boundary to browser", async () => {
  const body = new FormData();
  body.append("area", "shelf-a");
  body.append(
    "images",
    new Blob(["sample"], { type: "image/jpeg" }),
    "shelf.jpg",
  );
  await apiRequest(
    "https://api.example/api",
    "/inventory/scans",
    "test-token",
    {
      method: "POST",
      body,
      idempotencyKey: "test-uuid",
      fetchImpl: async (url, init) => {
        assert.equal(init.headers["Idempotency-Key"], "test-uuid");
        assert.equal(init.headers["Content-Type"], undefined);
        assert.equal(init.body, body);
        assert.equal(init.method, "POST");
        return ok({ data: { status: "pending_review" } });
      },
    },
  );
});
test("review JSON and bodyless approval use correct content headers", async () => {
  await apiRequest(
    "https://api.example/api",
    "/inventory/scans/scan/items/item",
    "test",
    {
      method: "PATCH",
      body: { confirmed: true, quantity: 4 },
      fetchImpl: async (url, init) => {
        assert.equal(init.headers["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(init.body), {
          confirmed: true,
          quantity: 4,
        });
        return ok({ data: {} });
      },
    },
  );
  await apiRequest(
    "https://api.example/api",
    "/inventory/scans/scan/approve",
    "test",
    {
      method: "POST",
      fetchImpl: async (url, init) => {
        assert.equal(init.body, undefined);
        assert.equal(init.headers["Content-Type"], undefined);
        return ok({ data: {} });
      },
    },
  );
});
test("failed writes are never retried and retain backend error message", async () => {
  let calls = 0;
  await assert.rejects(
    apiRequest(
      "https://api.example/api",
      "/inventory/scans/scan/approve",
      "test",
      {
        method: "POST",
        fetchImpl: async () => {
          calls++;
          return new Response(
            JSON.stringify({
              error: { code: "CONFLICT", message: "A newer scan was approved" },
            }),
            { status: 409 },
          );
        },
      },
    ),
    /A newer scan was approved/,
  );
  assert.equal(calls, 1);
});
test("authentication, malformed responses and insecure endpoints fail visibly", async () => {
  for (const status of [401, 403])
    await assert.rejects(
      apiRequest("https://api.example/api", "/products", "test", {
        fetchImpl: async () => new Response("", { status }),
      }),
      status === 401 ? /authentication/ : /staff access/,
    );
  await assert.rejects(
    apiRequest("https://api.example/api", "/health", "", {
      fetchImpl: async () => new Response("<html>proxy</html>"),
    }),
    /JSON/,
  );
  await assert.rejects(
    apiRequest("http://example.com/api", "/health"),
    /HTTPS/,
  );
  await assert.rejects(
    apiRequest("https://user:password@example.com/api", "/health"),
    /without credentials/,
  );
});
