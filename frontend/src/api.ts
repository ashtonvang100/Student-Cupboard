import type { Product } from "./data";
import { joinCatalog } from "./domain.mjs";
import { apiRequest, collectPages } from "./transport.mjs";
declare global {
  interface Window {
    CUPBOARD_CONFIG?: { apiBaseUrl: string; staleAfterHours: number };
  }
}
export const config = window.CUPBOARD_CONFIG || {
  apiBaseUrl: "",
  staleAfterHours: 24,
};
export const isDemo = !config.apiBaseUrl;
export type RequestOptions = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  timeout?: number;
  idempotencyKey?: string;
  baseUrl?: string;
};
export async function request(
  path: string,
  token = "",
  signal?: AbortSignal,
  options: RequestOptions = {},
): Promise<any> {
  if (!(options.baseUrl ?? config.apiBaseUrl))
    throw new Error("The backend is not connected yet.");
  return apiRequest(options.baseUrl ?? config.apiBaseUrl, path, token, {
    ...options,
    signal,
  });
}
export async function allPages(
  path: string,
  token: string,
  signal?: AbortSignal,
  baseUrl = config.apiBaseUrl,
): Promise<any[]> {
  return collectPages(
    (route: string) => request(route, token, signal, { baseUrl }),
    path,
  );
}
export async function getCatalog(
  token = "",
  signal?: AbortSignal,
  baseUrl = config.apiBaseUrl,
): Promise<Product[]> {
  const [products, categories, inventory] = await Promise.all(
    ["/products", "/categories", "/inventory"].map((path) =>
      allPages(path, token, signal, baseUrl),
    ),
  );
  return joinCatalog(products, categories, inventory);
}
export type ReviewItem = {
  id: string;
  productName: string | null;
  productId: number | null;
  categoryId: number | null;
  isNewProduct: boolean;
  quantity: number | null;
  unit: string | null;
  initialAreaQuantity: number | null;
  confirmed: boolean;
  excluded: boolean;
  expirationDate: string | null;
  brand?: string | null;
  packageSize?: string | null;
  variation?: string | null;
  warnings?: string[];
};
export type ScanRecord = {
  id: string;
  area: string;
  status: string;
  items: ReviewItem[];
  createdAt: string;
  errorCode?: string | null;
  analysis?: { warnings?: string[] };
};
export async function getScan(id: string, token: string): Promise<ScanRecord> {
  return (await request(`/inventory/scans/${encodeURIComponent(id)}`, token))
    .data;
}
export async function uploadScan(
  files: File[],
  area: string,
  key: string,
  token: string,
): Promise<ScanRecord> {
  const body = new FormData();
  body.append("area", area);
  files.forEach((f) => body.append("images", f));
  return (
    await request("/inventory/scans", token, undefined, {
      method: "POST",
      body,
      idempotencyKey: key,
      timeout: 120000,
    })
  ).data;
}
export async function reviewItem(
  scanId: string,
  item: ReviewItem,
  token: string,
): Promise<ScanRecord> {
  const {
    productId,
    categoryId,
    isNewProduct,
    productName,
    quantity,
    unit,
    initialAreaQuantity,
    excluded,
    expirationDate,
  } = item;
  const body = excluded
    ? { excluded: true, confirmed: false }
    : {
        productId,
        categoryId,
        isNewProduct,
        productName,
        quantity,
        unit,
        initialAreaQuantity,
        expirationDate,
        excluded: false,
        confirmed: true,
      };
  return (
    await request(
      `/inventory/scans/${encodeURIComponent(scanId)}/items/${encodeURIComponent(item.id)}`,
      token,
      undefined,
      { method: "PATCH", body },
    )
  ).data;
}
export async function decideScan(
  id: string,
  decision: "approve" | "reject",
  token: string,
): Promise<ScanRecord> {
  return (
    await request(
      `/inventory/scans/${encodeURIComponent(id)}/${decision}`,
      token,
      undefined,
      { method: "POST" },
    )
  ).data;
}
