import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { root, local } from "./common.mjs";
fs.mkdirSync(local, { recursive: true, mode: 0o700 });
const log = fs.openSync(path.join(local, "app.log"), "a", 0o600);
const child = spawn(process.execPath, ["scripts/dev.mjs"], {
  cwd: root,
  detached: true,
  stdio: ["ignore", log, log],
  env: process.env,
});
child.unref();
fs.closeSync(log);
console.log("Local app starting. Logs: .local/app.log");
