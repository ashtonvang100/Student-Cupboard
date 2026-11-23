import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const local = path.join(root, ".local");
export const pgBin =
  process.env.PG_BIN || "/opt/homebrew/opt/postgresql@17/bin";
export function run(command, args, options = {}) {
  const r = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(`${path.basename(command)} exited with ${r.status}`);
  return r;
}
export function settings() {
  return JSON.parse(fs.readFileSync(path.join(local, "settings.json"), "utf8"));
}
export function backendEnv() {
  const text = fs.readFileSync(path.join(root, "backend/.env"), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const at = l.indexOf("=");
        return [l.slice(0, at), l.slice(at + 1)];
      }),
  );
}
export function startDatabase() {
  const s = settings();
  const status = spawnSync(
    path.join(s.pgBin, "pg_ctl"),
    ["-D", path.join(local, "postgres"), "status"],
    { stdio: "ignore" },
  );
  if (status.status !== 0)
    run(path.join(s.pgBin, "pg_ctl"), [
      "-D",
      path.join(local, "postgres"),
      "-l",
      path.join(local, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -p ${s.pgPort} -k ${local}`,
      "-w",
      "start",
    ]);
}
