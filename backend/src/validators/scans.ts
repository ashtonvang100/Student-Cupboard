import { z } from "zod";
import { ApiError } from "../middleware/error-handler.js";
const text = (max = 200) => z.string().trim().min(1).max(max);
const amount = z.number().finite().min(0).max(1000000).nullable();
export const nutritionSchema = z
  .object({
    servingSize: text(100).nullable(),
    calories: amount,
    totalFatGrams: amount,
    saturatedFatGrams: amount,
    transFatGrams: amount,
    cholesterolMilligrams: amount,
    sodiumMilligrams: amount,
    totalCarbohydrateGrams: amount,
    dietaryFiberGrams: amount,
    totalSugarsGrams: amount,
    addedSugarsGrams: amount,
    proteinGrams: amount,
    micronutrients: z
      .array(
        z
          .object({ name: text(100), value: amount, unit: text(30).nullable() })
          .strict(),
      )
      .max(50),
    ingredients: text(8000).nullable(),
    allergens: z.array(text()).max(50),
    source: z.enum(["product_label", "estimate"]),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export const detectedItemSchema = z
  .object({
    productName: text().nullable(),
    brand: text().nullable(),
    category: text(120).nullable(),
    packageSize: text(100).nullable(),
    variation: text().nullable(),
    barcode: text(100).nullable(),
    quantity: z.number().int().min(0).max(2147483647).nullable(),
    unit: text(50).nullable(),
    quantityKind: z.enum(["visible_count", "estimate", "unknown"]),
    confidence: z.number().min(0).max(1),
    quantityConfidence: z.number().min(0).max(1),
    needsReview: z.boolean(),
    warnings: z.array(text(1000)).max(50),
    expirationDate: z.string().date().nullable(),
    nutrition: nutritionSchema.nullable(),
  })
  .strict();
export const analysisSchema = z
  .object({
    items: z.array(detectedItemSchema).max(200),
    warnings: z.array(text(1000)).max(100),
  })
  .strict();
export const reviewSchema = z
  .object({
    productName: text().nullable().optional(),
    brand: text().nullable().optional(),
    packageSize: text(100).nullable().optional(),
    variation: text().nullable().optional(),
    quantity: z.number().int().min(0).max(2147483647).nullable().optional(),
    unit: text(50).nullable().optional(),
    expirationDate: z.string().date().nullable().optional(),
    productId: z
      .number()
      .int()
      .positive()
      .max(2147483647)
      .nullable()
      .optional(),
    categoryId: z
      .number()
      .int()
      .positive()
      .max(2147483647)
      .nullable()
      .optional(),
    initialAreaQuantity: z
      .number()
      .int()
      .min(0)
      .max(2147483647)
      .nullable()
      .optional(),
    isNewProduct: z.boolean().optional(),
    excluded: z.boolean().optional(),
    confirmed: z.boolean(),
  })
  .strict();
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")
        .slice(0, 2000),
    );
  return result.data;
}
export const uuidSchema = z.string().uuid();
export const areaSchema = text(120).transform((s) => s.toLowerCase());
export type Analysis = z.infer<typeof analysisSchema>;
export type DetectedItem = z.infer<typeof detectedItemSchema>;
export type ScanItem = DetectedItem & {
  id: string;
  productId: number | null;
  categoryId: number | null;
  initialAreaQuantity: number | null;
  isNewProduct: boolean;
  excluded: boolean;
  confirmed: boolean;
};
export type Review = z.infer<typeof reviewSchema>;
