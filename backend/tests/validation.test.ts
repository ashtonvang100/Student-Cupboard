import { test } from "node:test";
import assert from "node:assert/strict";
import { productInput } from "../src/validators/products.js";
import { categoryInput } from "../src/validators/categories.js";
import {
  inventoryInput,
  transactionInput,
} from "../src/validators/inventory.js";
import { id } from "../src/validators/common.js";
import { databaseConfig } from "../src/config.js";
import { createDatabase } from "../src/db/index.js";
import { createApp } from "../src/app.js";

test("validates products and nutrition, preserving barcodes as strings", () => {
  assert.equal(
    productInput({
      name: " Rice ",
      categoryId: 1,
      barcode: "00123",
      nutrition: { calories: 150.5 },
    }).barcode,
    "00123",
  );
  for (const input of [
    null,
    [],
    {},
    { name: "x", categoryId: "1" },
    { name: "x", categoryId: 1, quantity: 3 },
    { name: "x", categoryId: 1, nutrition: { calories: -1 } },
    { name: "x", categoryId: 1, nutrition: { unknown: 2 } },
  ]) {
    assert.throws(() => productInput(input));
  }
  assert.throws(() => productInput({}, true));
});

test("validates category names and empty patches", () => {
  assert.deepEqual(categoryInput({ name: " Grains " }), { name: "Grains" });
  for (const input of [{ name: "" }, { name: 4 }, { name: "a", id: 1 }])
    assert.throws(() => categoryInput(input));
  assert.throws(() => categoryInput({}, true));
});

test("requires an adjustment reason and whole nonnegative quantities", () => {
  for (const input of [
    {},
    { quantity: -1, reason: "count" },
    { quantity: 1.5, reason: "count" },
    { quantity: 2 },
    { reason: "count" },
    { lowStockThreshold: -1 },
    { productId: 1 },
  ])
    assert.throws(() => inventoryInput(input));
  assert.deepEqual(inventoryInput({ quantity: 2, reason: " count " }), {
    quantity: 2,
    reason: "count",
  });
});

test("validates transaction signs, types, ranges, and reasons", () => {
  for (const input of [
    { transactionType: "removal", quantityChange: 1, reason: "x" },
    { transactionType: "addition", quantityChange: -1, reason: "x" },
    { transactionType: "adjustment", quantityChange: 0, reason: "x" },
    { transactionType: "unknown", quantityChange: 1, reason: "x" },
    { transactionType: "addition", quantityChange: 2147483648, reason: "x" },
    { transactionType: "addition", quantityChange: 1, reason: "" },
  ])
    assert.throws(() => transactionInput(input));
  assert.equal(
    transactionInput({
      transactionType: "removal",
      quantityChange: -2,
      reason: "distribution",
    }).quantityChange,
    -2,
  );
});

test("validates path IDs", () => {
  for (const value of ["0", "-1", "1.5", "1e2", "abc", "2147483648"])
    assert.throws(() => id(value));
});

test("rejects remote databases and wrong database names before opening connections", () => {
  const host = process.env.PGHOST;
  const name = process.env.PGDATABASE;
  try {
    process.env.PGHOST = "example.rds.amazonaws.com";
    assert.throws(databaseConfig, /Only local/);
    process.env.PGHOST = "localhost";
    process.env.PGDATABASE = "postgres";
    assert.throws(databaseConfig, /PGDATABASE/);
  } finally {
    if (host === undefined) delete process.env.PGHOST;
    else process.env.PGHOST = host;
    if (name === undefined) delete process.env.PGDATABASE;
    else process.env.PGDATABASE = name;
  }
});

test("HTTP validation, unknown routes, body limit, and unavailable health response", async () => {
  const { db, pool } = createDatabase({
    host: "127.0.0.1",
    port: 1,
    database: "student_cupboard_test",
    connectionTimeoutMillis: 100,
  });
  const testApp = createApp(db, {
    staff: [
      {
        id: "test-staff",
        role: "staff",
        token: "test-token-with-at-least-32-characters",
      },
    ],
  });
  const app = {
    request: (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set(
        "Authorization",
        "Bearer test-token-with-at-least-32-characters",
      );
      return testApp.request(path, { ...init, headers });
    },
  };
  try {
    assert.equal((await app.request("/api/health")).status, 503);
    assert.equal((await app.request("/no-such-route")).status, 404);
    for (const path of [
      "/api/products/abc",
      "/api/categories/0",
      "/api/inventory?page=0",
      "/api/products?limit=101",
      "/api/categories?page=1&page=2",
      "/api/inventory?unexpected=1",
    ]) {
      assert.equal((await app.request(path)).status, 400, path);
    }
    const malformed = await app.request("/api/categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    const media = await app.request("/api/categories", {
      method: "POST",
      body: "{}",
    });
    assert.equal(media.status, 415);
    const large = await app.request("/api/categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "a".repeat(70000) }),
    });
    assert.equal(large.status, 413);
    assert.deepEqual(await (await app.request("/api/health")).json(), {
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Database is unavailable",
      },
    });
  } finally {
    await pool.end();
  }
});
