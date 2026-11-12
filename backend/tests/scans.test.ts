import { test, mock } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import OpenAI from "openai";
import {
  prepareImages,
  MAX_IMAGE_BYTES,
} from "../src/services/images.service.js";
import { OpenAIVisionService } from "../src/services/openai.service.js";
import {
  analysisSchema,
  nutritionSchema,
  parse,
  reviewSchema,
} from "../src/validators/scans.js";
import { matchProduct, reviewItem } from "../src/services/scans.service.js";
import { createApp } from "../src/app.js";
import { createDatabase } from "../src/db/index.js";
import { ApiError } from "../src/middleware/error-handler.js";
import { detected, label, modelResponse } from "./scan-fixtures.js";
const image = { dataUrl: "data:image/jpeg;base64,test", hash: "test" };
test("decodes supported image formats, deduplicates, and resizes uploads", async () => {
  for (const type of ["png", "jpeg", "webp"] as const) {
    const bytes = await sharp({
      create: { width: 3000, height: 10, channels: 3, background: "white" },
    })
      .toFormat(type)
      .toBuffer();
    const file = new File([new Uint8Array(bytes)], `test.${type}`, {
      type: `image/${type}`,
    });
    const images = await prepareImages([file, file]);
    assert.equal(images.length, 1);
    assert.equal(
      (
        await sharp(
          Buffer.from(images[0]!.dataUrl.split(",")[1]!, "base64"),
        ).metadata()
      ).width,
      2400,
    );
  }
});
test("rejects invalid image bytes, mismatched media, oversized files and image counts", async () => {
  for (const files of [
    [],
    Array.from(
      { length: 6 },
      () => new File(["x"], "x.png", { type: "image/png" }),
    ),
    [new File(["x"], "x.gif", { type: "image/gif" })],
    [new File(["not an image"], "x.png", { type: "image/png" })],
    [
      new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "x.png", {
        type: "image/png",
      }),
    ],
  ]) {
    await assert.rejects(prepareImages(files), ApiError);
  }
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    prepareImages([
      new File([new Uint8Array(png)], "fake.jpg", { type: "image/jpeg" }),
    ]),
  );
});
test("validates complete nutrition, nullable unknown values, dates and strict review inputs", () => {
  assert.equal(parse(nutritionSchema, label).proteinGrams, 5);
  assert.equal(
    parse(analysisSchema, { items: [detected], warnings: [] }).items[0]!
      .expirationDate,
    null,
  );
  for (const nutrition of [
    { ...label, calories: -1 },
    { ...label, proteinGrams: "5" },
    { ...label, invented: 3 },
  ])
    assert.throws(() => parse(nutritionSchema, nutrition));
  assert.throws(() =>
    parse(reviewSchema, { quantity: 2, confirmed: true, needsReview: false }),
  );
  assert.throws(() => parse(reviewSchema, { quantity: 1.5, confirmed: true }));
});
test("matching requires an unambiguous product identity, size and variation", () => {
  const product = {
    id: 1,
    name: detected.productName!,
    brand: detected.brand,
    packageSize: detected.packageSize,
    variation: detected.variation,
    barcode: null,
    categoryId: 1,
    nutrition: null,
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  assert.equal(matchProduct(detected, [product]), 1);
  assert.equal(
    matchProduct({ ...detected, packageSize: "different" }, [product]),
    null,
  );
  assert.equal(
    matchProduct({ ...detected, variation: "different" }, [product]),
    null,
  );
  assert.equal(matchProduct(detected, [product, { ...product, id: 2 }]), null);
  assert.equal(
    reviewItem({ ...detected, quantityKind: "estimate" }, 1).needsReview,
    true,
  );
  assert.equal(
    reviewItem({ ...detected, quantityConfidence: 0.5 }, 1).confirmed,
    false,
  );
});
test("official SDK sends Responses images, structured schema, configurable model, and no storage", async () => {
  let request: Record<string, any> = {};
  const client = new OpenAI({
    apiKey: "mock-key",
    maxRetries: 0,
    fetch: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return Response.json(modelResponse({ items: [detected], warnings: [] }));
    },
  });
  const result = await new OpenAIVisionService(client, "gpt-5-mini").analyze([
    image,
  ]);
  assert.equal(result.items[0]!.nutrition!.proteinGrams, 5);
  assert.equal(request.model, "gpt-5-mini");
  assert.equal(request.store, false);
  assert.equal(request.input[0].content[1].type, "input_image");
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
});
test("sanitizes upstream errors, rate limits, timeouts, incomplete and malformed responses", async () => {
  for (const [response, status] of [
    [
      Response.json(
        { error: { message: "secret upstream detail" } },
        { status: 429 },
      ),
      429,
    ],
    [Response.json({ error: { message: "secret" } }, { status: 500 }), 502],
    [Response.json(modelResponse({ invalid: true })), 502],
    [
      Response.json({
        ...modelResponse({ items: [], warnings: [] }),
        status: "incomplete",
      }),
      502,
    ],
  ] as const) {
    const client = new OpenAI({
      apiKey: "mock-key",
      maxRetries: 0,
      fetch: async () => response,
    });
    await assert.rejects(
      new OpenAIVisionService(client).analyze([image]),
      (e: unknown) =>
        e instanceof ApiError &&
        e.status === status &&
        !e.message.includes("secret"),
    );
  }
  const client = new OpenAI({ apiKey: "mock-key" });
  mock.method(client.responses, "parse", async () => {
    throw new OpenAI.APIConnectionTimeoutError();
  });
  await assert.rejects(
    new OpenAIVisionService(client).analyze([image]),
    (e: unknown) => e instanceof ApiError && e.status === 504,
  );
});
test("requires authenticated staff for all inventory and scan routes, before database or AI calls", async () => {
  const { db, pool } = createDatabase({
    host: "127.0.0.1",
    port: 1,
    connectionTimeoutMillis: 10,
  });
  const app = createApp(db, {
    staff: [{ id: "viewer", role: "viewer", token: "a".repeat(32) }],
  });
  try {
    for (const [path, method] of [
      ["/api/inventory", "GET"],
      ["/api/products", "POST"],
      ["/api/inventory/scans", "POST"],
      ["/api/inventory/scans/abc/approve", "POST"],
      ["/api/inventory/scans/abc/items/abc", "PATCH"],
    ]) {
      assert.equal((await app.request(path!, { method })).status, 401);
      assert.equal(
        (
          await app.request(path!, {
            method,
            headers: { authorization: `Bearer ${"a".repeat(32)}` },
          })
        ).status,
        403,
      );
    }
  } finally {
    await pool.end();
  }
});
