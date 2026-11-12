import "dotenv/config";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import sharp from "sharp";
import { createDatabase } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { ScansService } from "../src/services/scans.service.js";
import { detected } from "./scan-fixtures.js";
import { ApiError } from "../src/middleware/error-handler.js";
const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_TEST_DATABASE === "1" && !url)
  throw new Error("Set a local TEST_DATABASE_URL");
describe("scan PostgreSQL integration", { skip: !url }, () => {
  const parsed = new URL(url!);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.pathname !== "/student_cupboard_test" ||
    parsed.search ||
    !["postgres:", "postgresql:"].includes(parsed.protocol)
  )
    throw new Error(
      "Tests require local student_cupboard_test without query parameters",
    );
  const { db, pool } = createDatabase({ connectionString: url, ssl: false });
  const actor = `scan-test-${randomUUID()}`;
  const token = "test-staff-token-with-32-characters";
  let categoryId: number;
  let productId: number;
  let calls = 0;
  const vision = {
    analyze: async () => {
      calls++;
      return { items: [{ ...detected, productName: actor }], warnings: [] };
    },
  };
  const service = new ScansService(db, vision);
  const app = createApp(db, {
    staff: [{ id: actor, role: "staff", token }],
    vision,
  });
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await app.request(`/api/inventory/scans${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, json: (await response.json()) as any };
  };
  const create = (area = actor) =>
    service.create(actor, randomUUID(), area, [
      { dataUrl: "mock", hash: randomUUID() },
    ]);
  const confirm = async (
    id: string,
    quantity: number,
    initialAreaQuantity: number | null = null,
  ) => {
    const scan = await service.get(id);
    return service.review(id, scan.items[0]!.id, {
      confirmed: true,
      productId,
      quantity,
      initialAreaQuantity,
    });
  };
  before(async () => {
    assert.equal(
      (await pool.query("select current_database() as name")).rows[0].name,
      "student_cupboard_test",
    );
    await migrate(db, { migrationsFolder: "./drizzle" });
    categoryId = (
      await pool.query("insert into categories(name) values($1) returning id", [
        actor,
      ])
    ).rows[0].id;
    productId = (
      await pool.query(
        "insert into products(name,brand,category_id,package_size,variation) values($1,$2,$3,$4,$5) returning id",
        [
          actor,
          detected.brand,
          categoryId,
          detected.packageSize,
          detected.variation,
        ],
      )
    ).rows[0].id;
    await pool.query(
      "insert into inventory(product_id,quantity,unit) values($1,100,'boxes')",
      [productId],
    );
  });
  after(async () => {
    try {
      await pool.query(
        "delete from inventory_transactions where product_id in (select id from products where category_id=$1)",
        [categoryId],
      );
      await pool.query(
        "delete from inventory_area_counts where product_id in (select id from products where category_id=$1)",
        [categoryId],
      );
      await pool.query(
        "delete from product_nutrition where product_id in (select id from products where category_id=$1)",
        [categoryId],
      );
      await pool.query("delete from inventory_scans where actor_id=$1", [
        actor,
      ]);
      await pool.query(
        "delete from inventory where product_id in (select id from products where category_id=$1)",
        [categoryId],
      );
      await pool.query("delete from products where category_id=$1", [
        categoryId,
      ]);
      await pool.query("delete from categories where id=$1", [categoryId]);
    } finally {
      await pool.end();
    }
  });
  test("uploads multipart images, records pending results and reuses identical submissions", async () => {
    const bytes = await sharp({
      create: { width: 5, height: 5, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const upload = async (key: string) => {
      const form = new FormData();
      form.append("area", actor);
      form.append(
        "images",
        new File([new Uint8Array(bytes)], "shelf.png", { type: "image/png" }),
      );
      return app.request("/api/inventory/scans", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "Idempotency-Key": key },
        body: form,
      });
    };
    const key = randomUUID();
    const first = await upload(key);
    assert.equal(first.status, 201);
    const scan = ((await first.json()) as any).data;
    assert.equal(scan.status, "pending_review");
    assert.equal(scan.items[0].productId, productId);
    const before = calls;
    assert.equal(((await (await upload(key)).json()) as any).data.id, scan.id);
    assert.equal(calls, before);
    assert.equal((await request(`/${scan.id}`)).status, 200);
    assert.equal((await request("?limit=1")).json.pagination.limit, 1);
    assert.equal(
      (
        await request(`/${scan.id}/items/${scan.items[0].id}`, "PATCH", {
          quantity: 15,
          confirmed: true,
        })
      ).status,
      200,
    );
    assert.equal((await request(`/${scan.id}/reject`, "POST")).status, 200);
    assert.equal((await request(`/${scan.id}/approve`, "POST")).status, 409);
  });
  test("rejects idempotency key reuse even when another scan has the requested images", async () => {
    const firstKey = randomUUID();
    const firstImages = [{ dataUrl: "mock", hash: randomUUID() }];
    const otherImages = [{ dataUrl: "mock", hash: randomUUID() }];
    await service.create(actor, firstKey, actor, firstImages);
    await service.create(actor, randomUUID(), actor, otherImages);
    const before = calls;
    await assert.rejects(
      service.create(actor, firstKey, actor, otherImages),
      /Key was already used/,
    );
    await assert.rejects(
      service.create(
        actor,
        randomUUID(),
        `${actor}-different-area`,
        firstImages,
      ),
      /Key was already used/,
    );
    assert.equal(calls, before);
  });
  test("identity corrections clear stale product matches and extracted nutrition", async () => {
    const scan = await create();
    const updated = await service.review(scan.id, scan.items[0]!.id, {
      productName: "Corrected product",
      confirmed: false,
    });
    assert.equal(updated.items[0]!.productId, null);
    assert.equal(updated.items[0]!.nutrition, null);
    await assert.rejects(service.approve(scan.id, actor));
  });
  test("requires explicit confirmation and first-area baseline; approval changes only the observed area", async () => {
    const scan = await create();
    await assert.rejects(service.approve(scan.id, actor), ApiError);
    await confirm(scan.id, 12);
    await assert.rejects(
      service.approve(scan.id, actor),
      /initialAreaQuantity/,
    );
    await confirm(scan.id, 12, 10);
    await service.review(scan.id, scan.items[0]!.id, {
      confirmed: true,
      expirationDate: "2027-12-01",
    });
    const approved = await service.approve(scan.id, actor);
    assert.equal(approved.status, "approved");
    assert.equal(
      (
        await pool.query("select quantity from inventory where product_id=$1", [
          productId,
        ])
      ).rows[0].quantity,
      102,
    );
    const history = (
      await pool.query(
        "select * from inventory_transactions where scan_id=$1",
        [scan.id],
      )
    ).rows;
    assert.equal(history.length, 1);
    assert.equal(history[0].previous_quantity, 100);
    assert.equal(history[0].new_quantity, 102);
    assert.equal(history[0].actor_id, actor);
    assert.equal(
      (
        await pool.query(
          "select expiration_date::text from inventory_area_counts where product_id=$1 and area=$2",
          [productId, actor],
        )
      ).rows[0].expiration_date,
      "2027-12-01",
    );
    const nutrition = (
      await pool.query("select * from product_nutrition where product_id=$1", [
        productId,
      ])
    ).rows[0];
    assert.equal(nutrition.data.source, "product_label");
    assert.equal(nutrition.verified, false);
    await Promise.all([
      service.approve(scan.id, actor),
      service.approve(scan.id, actor),
    ]);
    assert.equal(
      (
        await pool.query("select quantity from inventory where product_id=$1", [
          productId,
        ])
      ).rows[0].quantity,
      102,
    );
  });
  test("rescans apply delta, preserve other areas and do not zero missing products", async () => {
    const scan = await create();
    await confirm(scan.id, 7);
    await service.approve(scan.id, actor);
    assert.equal(
      (
        await pool.query("select quantity from inventory where product_id=$1", [
          productId,
        ])
      ).rows[0].quantity,
      97,
    );
    const other = await create(`${actor}-freezer`);
    await confirm(other.id, 5, 5);
    await service.approve(other.id, actor);
    assert.equal(
      (
        await pool.query("select quantity from inventory where product_id=$1", [
          productId,
        ])
      ).rows[0].quantity,
      97,
    );
  });
  test("rejects stale scans and leaves all stock untouched", async () => {
    const older = await create();
    const newer = await create();
    await confirm(older.id, 1);
    await confirm(newer.id, 8);
    await service.approve(newer.id, actor);
    await assert.rejects(
      service.approve(older.id, actor),
      /rescan|newer count/,
    );
    assert.equal((await service.get(older.id)).status, "pending_review");
  });
  test("rolls back earlier item changes when a later item fails validation", async () => {
    const failure = new ScansService(db, {
      analyze: async () => ({
        items: [
          { ...detected, productName: actor },
          { ...detected, productName: "Missing" },
        ],
        warnings: [],
      }),
    });
    const scan = await failure.create(
      actor,
      randomUUID(),
      `${actor}-rollback`,
      [{ dataUrl: "mock", hash: randomUUID() }],
    );
    await confirm(scan.id, 100, 0);
    await service.review(scan.id, scan.items[1]!.id, {
      confirmed: true,
      productId: 2147483647,
    });
    const before = (
      await pool.query("select quantity from inventory where product_id=$1", [
        productId,
      ])
    ).rows;
    await assert.rejects(service.approve(scan.id, actor));
    assert.deepEqual(
      (
        await pool.query("select quantity from inventory where product_id=$1", [
          productId,
        ])
      ).rows,
      before,
    );
    assert.equal(
      (
        await pool.query(
          "select * from inventory_transactions where scan_id=$1",
          [scan.id],
        )
      ).rowCount,
      0,
    );
    assert.equal((await service.get(scan.id)).status, "pending_review");
  });
  test("records AI failures and malformed results without touching inventory", async () => {
    for (const analyze of [
      async () => {
        throw new ApiError(502, "AI_UNAVAILABLE", "Failed");
      },
      async () => ({ items: [{ nonsense: true }], warnings: [] }),
    ]) {
      const failing = new ScansService(db, { analyze } as any);
      const key = randomUUID();
      await assert.rejects(
        failing.create(actor, key, actor, [
          { dataUrl: "mock", hash: randomUUID() },
        ]),
      );
      assert.equal(
        (
          await pool.query(
            "select status from inventory_scans where actor_id=$1 and idempotency_key=$2",
            [actor, key],
          )
        ).rows[0].status,
        "failed",
      );
    }
  });
  test("database foreign-key failure rolls back newly created products and stock", async () => {
    const failing = new ScansService(db, {
      analyze: async () => ({
        items: [
          { ...detected, productName: `${actor}-db-rollback-1` },
          { ...detected, productName: `${actor}-db-rollback-2` },
        ],
        warnings: [],
      }),
    });
    const scan = await failing.create(
      actor,
      randomUUID(),
      `${actor}-db-rollback`,
      [{ dataUrl: "mock", hash: randomUUID() }],
    );
    for (const [index, item] of scan.items.entries())
      await service.review(scan.id, item.id, {
        confirmed: true,
        productId: null,
        isNewProduct: true,
        categoryId: index === 0 ? categoryId : 2147483647,
      });
    await assert.rejects(service.approve(scan.id, actor));
    assert.equal(
      (
        await pool.query("select id from products where name=$1", [
          `${actor}-db-rollback-1`,
        ])
      ).rowCount,
      0,
    );
    assert.equal((await service.get(scan.id)).status, "pending_review");
  });
  test("never replaces verified nutrition with AI candidates", async () => {
    await pool.query(
      "update product_nutrition set verified=true, data=jsonb_set(data,'{calories}','42') where product_id=$1",
      [productId],
    );
    const scan = await create(`${actor}-nutrition`);
    await confirm(scan.id, 1, 0);
    await service.approve(scan.id, actor);
    const profile = (
      await pool.query(
        "select data,verified from product_nutrition where product_id=$1",
        [productId],
      )
    ).rows[0];
    assert.equal(profile.data.calories, 42);
    assert.equal(profile.verified, true);
  });
  test("creates explicitly reviewed products and excludes incorrect detections", async () => {
    const scan = await create(`${actor}-new`);
    await service.review(scan.id, scan.items[0]!.id, {
      confirmed: true,
      isNewProduct: true,
      productId: null,
      productName: `${actor}-new`,
      categoryId,
      quantity: 3,
    });
    const approved = await service.approve(scan.id, actor);
    assert.ok(approved.items[0]!.productId);
    assert.equal(
      (
        await pool.query("select quantity from inventory where product_id=$1", [
          approved.items[0]!.productId,
        ])
      ).rows[0].quantity,
      3,
    );
    const excluded = await create(`${actor}-exclude`);
    await service.review(excluded.id, excluded.items[0]!.id, {
      confirmed: false,
      excluded: true,
    });
    assert.equal(
      (await service.approve(excluded.id, actor)).status,
      "approved",
    );
  });
});
