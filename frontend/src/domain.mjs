export function availability(item, now = Date.now(), staleHours = 24) {
  const date = Date.parse(item.updatedAt || "");
  if (
    !Number.isFinite(date) ||
    now - date > staleHours * 3600000 ||
    date > now + 60000 ||
    item.unclear
  )
    return { label: "Needs update", current: false };
  return item.quantity > 0
    ? { label: "Available", current: true }
    : { label: "Not available", current: false };
}
export function validateImages(files) {
  if (files.length < 1 || files.length > 5)
    return "Choose between 1 and 5 photos.";
  if (
    files.some(
      (f) => !["image/jpeg", "image/png", "image/webp"].includes(f.type),
    )
  )
    return "Use JPEG, PNG, or WebP photos.";
  if (files.some((f) => f.size > 8 * 1024 * 1024))
    return "Each photo must be 8 MiB or smaller.";
  if (files.reduce((sum, f) => sum + f.size, 0) > 24 * 1024 * 1024)
    return "Photos must total 24 MiB or less.";
  return "";
}
export function canApprove(items) {
  return (
    items.length > 0 &&
    items.every(
      (i) =>
        i.reviewed &&
        (i.excluded || (Number.isInteger(i.quantity) && i.quantity >= 0)),
    )
  );
}
export function joinCatalog(products, categories, inventory) {
  const categoriesById = new Map(categories.map((c) => [c.id, c.name]));
  const inventoryByProductId = new Map(inventory.map((i) => [i.productId, i]));
  return products.map((p) => {
    const stock = inventoryByProductId.get(p.id);
    return {
      id: String(p.id),
      inventoryId: stock?.id,
      name: p.name,
      category: categoriesById.get(p.categoryId) || "Uncategorized",
      image: "/food-placeholder.svg",
      quantity: stock?.quantity ?? 0,
      updatedAt: null,
      inventoryUpdatedAt: stock?.updatedAt ?? null,
      description: p.description || "No description recorded.",
      serving: p.nutrition?.servingSize || "Serving size not recorded",
      nutrition: p.nutrition
        ? {
            calories: p.nutrition.calories ?? null,
            protein: p.nutrition.proteinGrams ?? null,
            carbs: p.nutrition.totalCarbohydrateGrams ?? null,
            fat: p.nutrition.totalFatGrams ?? null,
          }
        : null,
    };
  });
}
