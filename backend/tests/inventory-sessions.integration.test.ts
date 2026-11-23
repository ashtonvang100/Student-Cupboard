import "dotenv/config";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "../src/db/index.js";
import {
  inventoryAreas,
  inventoryScanSessions,
  inventorySessionAreas,
} from "../src/db/schema.js";
import { createInventoryScanSession } from "../src/services/scan-session-persistence.js";

function hasPostgresCode(...codes: string[]) {
  return (error: unknown) =>
    error instanceof Error &&
    error.cause instanceof pg.DatabaseError &&
    codes.includes(error.cause.code ?? "");
}

const url = process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_TEST_DATABASE === "1" && !url)
  throw new Error("Set a local TEST_DATABASE_URL");

describe("inventory area and session persistence", { skip: !url }, () => {
  const parsed = new URL(url!);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    parsed.pathname !== "/student_cupboard_test" ||
    parsed.search ||
    parsed.hash ||
    !["postgres:", "postgresql:"].includes(parsed.protocol)
  ) {
    throw new Error(
      "Tests require local student_cupboard_test without query parameters or fragments",
    );
  }

  const { db, pool } = createDatabase({
    connectionString: url,
    ssl: false,
    connectionTimeoutMillis: 2000,
  });
  const rollback = new Error("Roll back test fixtures");
  const request = () => ({
    actorId: `staff-${randomUUID()}`,
    idempotencyKey: randomUUID(),
  });

  async function withFixtures(run: Parameters<typeof db.transaction>[0]) {
    try {
      await db.transaction(async (tx) => {
        await run(tx);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }

  before(async () => {
    assert.equal(
      (await pool.query("select current_database() as name")).rows[0].name,
      "student_cupboard_test",
    );
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  after(() => pool.end());

  test("registers and archives an area with a stable UUID", () =>
    withFixtures(async (tx) => {
      const [area] = await tx
        .insert(inventoryAreas)
        .values({ name: "Pantry / Shelf A" })
        .returning();
      assert.match(area!.id, /^[0-9a-f-]{36}$/);
      assert.ok(area!.createdAt instanceof Date);
      assert.equal(area!.archivedAt, null);

      const [archived] = await tx
        .update(inventoryAreas)
        .set({ archivedAt: new Date() })
        .where(eq(inventoryAreas.id, area!.id))
        .returning();
      assert.equal(archived!.id, area!.id);
      assert.ok(archived!.archivedAt instanceof Date);

      await assert.rejects(
        tx.transaction((savepoint) =>
          savepoint.insert(inventoryAreas).values({ name: "pantry / shelf a" }),
        ),
        hasPostgresCode("23505"),
      );
      for (const name of ["", " Shelf B ", "Shelf\nB"]) {
        await assert.rejects(
          tx.transaction((savepoint) =>
            savepoint.insert(inventoryAreas).values({ name }),
          ),
          hasPostgresCode("23514"),
        );
      }
    }));

  test("a full session snapshots every active area and excludes archived areas", () =>
    withFixtures(async (tx) => {
      const areas = await tx
        .insert(inventoryAreas)
        .values([
          { name: "Pantry / Shelf A" },
          { name: "Pantry / Shelf B" },
          { name: "Retired / Shelf C", archivedAt: new Date() },
        ])
        .returning();

      const result = await createInventoryScanSession(tx, {
        ...request(),
        mode: "full",
      });
      assert.equal(result.created, true);
      assert.equal(result.session.mode, "full");
      assert.equal(result.session.closedAt, null);
      const members = await tx
        .select()
        .from(inventorySessionAreas)
        .where(eq(inventorySessionAreas.sessionId, result.session.id));
      const expected = [areas[0]!.id, areas[1]!.id].sort();
      assert.deepEqual(result.areaIds, expected);
      assert.deepEqual(members.map((member) => member.areaId).sort(), expected);
    }));

  test("an individual session keeps exactly one selected active area", () =>
    withFixtures(async (tx) => {
      const [selected] = await tx
        .insert(inventoryAreas)
        .values([{ name: "Selected area" }, { name: "Other area" }])
        .returning();
      const input = {
        ...request(),
        mode: "individual" as const,
        areaId: selected!.id,
      };
      const result = await createInventoryScanSession(tx, input);
      assert.equal(result.session.mode, "individual");
      assert.deepEqual(result.areaIds, [selected!.id]);
      assert.deepEqual(
        await tx
          .select()
          .from(inventorySessionAreas)
          .where(eq(inventorySessionAreas.sessionId, result.session.id)),
        [{ sessionId: result.session.id, areaId: selected!.id }],
      );
      await tx
        .update(inventoryAreas)
        .set({ archivedAt: new Date() })
        .where(eq(inventoryAreas.id, selected!.id));
      const replay = await createInventoryScanSession(tx, {
        ...input,
        areaId: selected!.id.toUpperCase(),
      });
      assert.equal(replay.created, false);
      assert.equal(replay.session.id, result.session.id);
      assert.deepEqual(replay.areaIds, result.areaIds);
      await assert.rejects(
        createInventoryScanSession(tx, {
          ...input,
          idempotencyKey: randomUUID(),
        }),
        {
          status: 409,
          code: "AREA_ARCHIVED",
        },
      );
      await assert.rejects(
        createInventoryScanSession(tx, {
          ...input,
          idempotencyKey: randomUUID(),
          areaId: randomUUID(),
        }),
        {
          status: 404,
          code: "AREA_NOT_FOUND",
        },
      );
    }));

  test("rejects full creation with no active areas and rolls back the session", () =>
    withFixtures(async (tx) => {
      await tx
        .insert(inventoryAreas)
        .values({ name: "Retired area", archivedAt: new Date() });
      const input = { ...request(), mode: "full" as const };
      await assert.rejects(createInventoryScanSession(tx, input), {
        status: 409,
        code: "NO_ACTIVE_AREAS",
      });
      assert.deepEqual(
        await tx
          .select()
          .from(inventoryScanSessions)
          .where(eq(inventoryScanSessions.actorId, input.actorId)),
        [],
      );

      const [active] = await tx
        .insert(inventoryAreas)
        .values({ name: "Current area" })
        .returning();
      const result = await createInventoryScanSession(tx, input);
      assert.equal(result.created, true);
      assert.deepEqual(result.areaIds, [active!.id]);
    }));

  test("registry changes preserve existing manifests and full replay uses the original snapshot", () =>
    withFixtures(async (tx) => {
      const [renamed, archived] = await tx
        .insert(inventoryAreas)
        .values([{ name: "Previous area name" }, { name: "Area to retire" }])
        .returning();
      const input = { ...request(), mode: "full" as const };
      const original = await createInventoryScanSession(tx, input);
      await tx
        .update(inventoryAreas)
        .set({ name: "New area name" })
        .where(eq(inventoryAreas.id, renamed!.id));
      await tx
        .update(inventoryAreas)
        .set({ archivedAt: new Date() })
        .where(eq(inventoryAreas.id, archived!.id));
      const [added] = await tx
        .insert(inventoryAreas)
        .values({ name: "Recently registered area" })
        .returning();

      const replay = await createInventoryScanSession(tx, input);
      assert.equal(replay.created, false);
      assert.equal(replay.session.id, original.session.id);
      assert.deepEqual(replay.areaIds, [renamed!.id, archived!.id].sort());
      const next = await createInventoryScanSession(tx, {
        ...input,
        idempotencyKey: randomUUID(),
      });
      assert.deepEqual(next.areaIds, [renamed!.id, added!.id].sort());
      await assert.rejects(
        createInventoryScanSession(tx, {
          ...input,
          mode: "individual",
          areaId: added!.id,
        }),
        {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
        },
      );
      const individual = {
        ...request(),
        mode: "individual" as const,
        areaId: added!.id,
      };
      await createInventoryScanSession(tx, individual);
      await assert.rejects(
        createInventoryScanSession(tx, { ...individual, areaId: renamed!.id }),
        {
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
        },
      );
    }));

  test("the database rejects invalid session modes and closure times", () =>
    withFixtures(async (tx) => {
      const input = request();
      await assert.rejects(
        tx.transaction((savepoint) =>
          savepoint.execute(sql`
      insert into inventory_scan_sessions (mode, actor_id, idempotency_key)
      values ('invalid', ${input.actorId}, ${input.idempotencyKey})
    `),
        ),
        hasPostgresCode("23514"),
      );
      await assert.rejects(
        tx.transaction((savepoint) =>
          savepoint
            .insert(inventoryScanSessions)
            .values({ ...input, mode: "full", closedAt: new Date(0) }),
        ),
        hasPostgresCode("23514"),
      );
    }));

  test("the database guards member references, uniqueness, and historical parents", () =>
    withFixtures(async (tx) => {
      const [area] = await tx
        .insert(inventoryAreas)
        .values({ name: "Referenced area" })
        .returning();
      const { session } = await createInventoryScanSession(tx, {
        ...request(),
        mode: "individual",
        areaId: area!.id,
      });
      await assert.rejects(
        tx.transaction((savepoint) =>
          savepoint
            .insert(inventorySessionAreas)
            .values({ sessionId: randomUUID(), areaId: area!.id }),
        ),
        hasPostgresCode("23503"),
      );
      await assert.rejects(
        tx.transaction((savepoint) =>
          savepoint
            .insert(inventorySessionAreas)
            .values({ sessionId: session.id, areaId: randomUUID() }),
        ),
        hasPostgresCode("23503"),
      );
      await assert.rejects(
        tx.transaction((savepoint) =>
          savepoint
            .insert(inventorySessionAreas)
            .values({ sessionId: session.id, areaId: area!.id }),
        ),
        hasPostgresCode("23505"),
      );
      // PostgreSQL can report RESTRICT as a distinct violation or a foreign-key violation.
      const restrictsDelete = hasPostgresCode("23001", "23503");
      await assert.rejects(
        tx.transaction((savepoint) =>
          savepoint
            .delete(inventoryAreas)
            .where(eq(inventoryAreas.id, area!.id)),
        ),
        restrictsDelete,
      );
      await assert.rejects(
        tx.transaction((savepoint) =>
          savepoint
            .delete(inventoryScanSessions)
            .where(eq(inventoryScanSessions.id, session.id)),
        ),
        restrictsDelete,
      );
    }));
});
