import { timingSafeEqual, createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import { ApiError } from "./error-handler.js";
export type Staff = { id: string; token: string; role: "staff" | "viewer" };
export type StaffEnv = { Variables: { staff: Staff } };
const credentials = z.array(
  z
    .object({
      id: z.string().min(1).max(200),
      token: z.string().min(32),
      role: z.enum(["staff", "viewer"]),
    })
    .strict(),
);
export function staffCredentials(): Staff[] {
  return credentials.parse(JSON.parse(process.env.STAFF_API_TOKENS || "[]"));
}
export function authenticate(staff: Staff[]): MiddlewareHandler<StaffEnv> {
  return async (c, next) => {
    const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    const digest = (value: string) =>
      createHash("sha256").update(value).digest();
    const actor =
      token &&
      staff.find((s) => timingSafeEqual(digest(s.token), digest(token)));
    if (!actor)
      throw new ApiError(
        401,
        "UNAUTHORIZED",
        "A valid staff bearer token is required",
      );
    if (actor.role !== "staff")
      throw new ApiError(403, "FORBIDDEN", "Staff access is required");
    c.set("staff", actor);
    await next();
  };
}
