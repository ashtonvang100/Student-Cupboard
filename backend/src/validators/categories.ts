import { object, keys, string, invalid } from "./common.js";

export function categoryInput(value: unknown, patch = false) {
  const input = object(value);
  keys(input, ["name", "description"]);
  const result: { name?: string; description?: string | null } = {};
  if ("name" in input) result.name = string(input.name, "name", 120);
  if ("description" in input)
    result.description =
      input.description === null
        ? null
        : string(input.description, "description");
  if (!patch && !result.name) invalid("name is required");
  if (patch && !Object.keys(result).length)
    invalid("Provide at least one field to update");
  return result;
}
