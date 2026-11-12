import {
  object,
  keys,
  string,
  integer,
  invalid,
  MAX_INTEGER,
} from "./common.js";

export type InventoryPatch = {
  quantity?: number;
  unit?: string;
  lowStockThreshold?: number;
  reason?: string;
};
export function inventoryInput(value: unknown): InventoryPatch {
  const input = object(value);
  keys(input, ["quantity", "unit", "lowStockThreshold", "reason"]);
  const result: InventoryPatch = {};
  if ("quantity" in input)
    result.quantity = integer(input.quantity, "quantity");
  if ("lowStockThreshold" in input)
    result.lowStockThreshold = integer(
      input.lowStockThreshold,
      "lowStockThreshold",
    );
  if ("unit" in input) result.unit = string(input.unit, "unit", 50);
  if ("reason" in input) result.reason = string(input.reason, "reason");
  if (result.quantity !== undefined && !result.reason)
    invalid("reason is required when setting quantity");
  if (result.quantity === undefined && result.reason)
    invalid("reason requires a quantity change");
  if (
    result.quantity === undefined &&
    result.unit === undefined &&
    result.lowStockThreshold === undefined
  )
    invalid("Provide at least one field to update");
  return result;
}
export type TransactionInput = {
  transactionType: "addition" | "removal" | "adjustment";
  quantityChange: number;
  reason: string;
};
export function transactionInput(value: unknown): TransactionInput {
  const input = object(value);
  keys(input, ["transactionType", "quantityChange", "reason"]);
  const type = input.transactionType;
  if (type !== "addition" && type !== "removal" && type !== "adjustment")
    invalid("transactionType must be addition, removal, or adjustment");
  const delta = integer(input.quantityChange, "quantityChange", -MAX_INTEGER);
  if (
    delta === 0 ||
    (type === "addition" && delta < 0) ||
    (type === "removal" && delta > 0)
  )
    invalid(
      "quantityChange must be positive for addition, negative for removal, and nonzero for adjustment",
    );
  return {
    transactionType: type,
    quantityChange: delta,
    reason: string(input.reason, "reason"),
  };
}
