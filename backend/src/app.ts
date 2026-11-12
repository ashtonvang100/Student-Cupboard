import {
  authenticate,
  staffCredentials,
  type Staff,
  type StaffEnv,
} from "./middleware/auth.js";
import { scanRoutes } from "./routes/scans.js";
import { ScansService } from "./services/scans.service.js";
import {
  OpenAIVisionService,
  type VisionAnalyzer,
} from "./services/openai.service.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { sql } from "drizzle-orm";
import type { Database } from "./db/index.js";
import { ApiError, errorHandler } from "./middleware/error-handler.js";
import { categoryRoutes } from "./routes/categories.js";
import { productRoutes } from "./routes/products.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { CategoriesService } from "./services/categories.service.js";
import { ProductsService } from "./services/products.service.js";
import { InventoryService } from "./services/inventory.service.js";

export function createApp(
  db: Database,
  options: { staff?: Staff[]; vision?: VisionAnalyzer } = {},
) {
  const app = new Hono<StaffEnv>();
  app.use("*", secureHeaders());
  const auth = authenticate(options.staff ?? staffCredentials());
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health") return next();
    return auth(c, next);
  });
  const jsonLimit = bodyLimit({
    maxSize: 64 * 1024,
    onError: () => {
      throw new ApiError(413, "BODY_TOO_LARGE", "Request body exceeds 64 KiB");
    },
  });
  app.use("*", (c, next) =>
    c.req.method === "POST" && c.req.path === "/api/inventory/scans"
      ? next()
      : jsonLimit(c, next),
  );
  app.onError(errorHandler);
  app.notFound((c) =>
    c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
  );
  app.get("/", (c) => c.text("Hello Hono!"));
  app.get("/api/health", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      await db.execute(sql`select 1`);
      return c.json({ data: { status: "ok", database: "connected" } });
    } catch {
      return c.json(
        {
          error: {
            code: "DATABASE_UNAVAILABLE",
            message: "Database is unavailable",
          },
        },
        503,
      );
    }
  });
  app.route("/api/categories", categoryRoutes(new CategoriesService(db)));
  app.route("/api/products", productRoutes(new ProductsService(db)));
  app.route(
    "/api/inventory/scans",
    scanRoutes(
      new ScansService(db, options.vision ?? new OpenAIVisionService()),
    ),
  );
  app.route("/api/inventory", inventoryRoutes(new InventoryService(db)));
  return app;
}
