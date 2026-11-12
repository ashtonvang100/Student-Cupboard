import "dotenv/config";
import type { PoolConfig } from "pg";
import { userInfo } from "node:os";

export function integerSetting(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return Number(value);
}

type DatabaseConfig = PoolConfig & {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl: false | { ca: string; rejectUnauthorized: true };
};

export function databaseConfig(): DatabaseConfig {
  const url = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL)
    : undefined;
  if (
    url &&
    (!["postgres:", "postgresql:"].includes(url.protocol) ||
      url.search ||
      url.hash)
  )
    throw new Error(
      "DATABASE_URL must be a PostgreSQL URL without query parameters or fragments",
    );
  const host =
    url?.hostname.replace(/^\[|\]$/g, "") || process.env.PGHOST || "localhost";
  const remote = !["localhost", "127.0.0.1", "::1"].includes(host);
  const name = url
    ? decodeURIComponent(url.pathname.slice(1))
    : process.env.PGDATABASE;
  if (remote) {
    if (
      process.env.DATABASE_ALLOW_REMOTE !== "true" ||
      !process.env.DATABASE_CA_CERT
    )
      throw new Error(
        "Only local PostgreSQL hosts are enabled unless DATABASE_ALLOW_REMOTE=true and DATABASE_CA_CERT is configured",
      );
  }
  if (!remote && name !== "student_cupboard") {
    throw new Error("PGDATABASE must be student_cupboard");
  }
  return {
    host,
    port: integerSetting(url?.port || process.env.PGPORT, 5432, "PGPORT"),
    database: name || "student_cupboard",
    user: url
      ? decodeURIComponent(url.username)
      : process.env.PGUSER || userInfo().username,
    password: url
      ? decodeURIComponent(url.password) || undefined
      : process.env.PGPASSWORD || undefined,
    ssl: remote
      ? { ca: process.env.DATABASE_CA_CERT!, rejectUnauthorized: true }
      : false,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
  };
}
