import { eq } from "drizzle-orm";
import type { Database } from "../db/index.js";
import { products, inventory, productNutrition } from "../db/schema.js";
import { ApiError } from "../middleware/error-handler.js";
import type { Pagination } from "../validators/common.js";
import type { ProductInput } from "../validators/products.js";

export class ProductsService {
  constructor(private db: Database) {}
  list(p: Pagination) {
    return this.db
      .select()
      .from(products)
      .orderBy(products.id)
      .limit(p.limit + 1)
      .offset(p.offset);
  }
  async get(id: number) {
    const [row] = await this.db
      .select()
      .from(products)
      .where(eq(products.id, id));
    if (!row) throw new ApiError(404, "NOT_FOUND", "Product not found");
    const [profile] = await this.db
      .select()
      .from(productNutrition)
      .where(eq(productNutrition.productId, id));
    return { ...row, aiNutrition: profile ?? null };
  }
  async create(input: ProductInput & { name: string; categoryId: number }) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(products).values(input).returning();
      await tx.insert(inventory).values({ productId: row!.id });
      return row!;
    });
  }
  async update(id: number, input: ProductInput) {
    const [row] = await this.db
      .update(products)
      .set(input)
      .where(eq(products.id, id))
      .returning();
    if (!row) throw new ApiError(404, "NOT_FOUND", "Product not found");
    return row;
  }
}
