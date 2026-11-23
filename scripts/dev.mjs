import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { root, local, run, startDatabase, backendEnv } from "./common.mjs";
if (!fs.existsSync(path.join(local, "settings.json")))
  run(process.execPath, ["scripts/setup.mjs"]);
else startDatabase();
const env = backendEnv();
const children = [];
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  for (const c of children) c.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const backend = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: path.join(root, "backend"),
  env: { ...process.env, ...env },
  stdio: "inherit",
});
children.push(backend);
backend.on("exit", (code) => {
  if (!closing) {
    console.error(`Backend stopped (${code}).`);
    stop();
    process.exitCode = code || 1;
  }
});
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (closing) throw new Error("Backend exited");
    try {
      const r = await fetch("http://127.0.0.1:3000/api/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error("Backend did not become healthy.");
  if (!fs.existsSync(path.join(local, "sample-data-seeded")))
    run(process.execPath, ["scripts/seed.mjs"]);
  const frontend = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "5173",
      "--strictPort",
    ],
    { cwd: path.join(root, "frontend"), env: process.env, stdio: "inherit" },
  );
  children.push(frontend);
  frontend.on("exit", (code) => {
    if (!closing) {
      stop();
      process.exitCode = code || 1;
    }
  });
  fs.writeFileSync(
    path.join(local, "processes.json"),
    JSON.stringify({
      launcher: process.pid,
      backend: backend.pid,
      frontend: frontend.pid,
    }),
  );
  console.log(
    "\nOpen http://127.0.0.1:5173\nSign in with the token from .local/staff-token.txt.\nCtrl+C stops the app. Use the Stop Local App script to also stop PostgreSQL.",
  );
} catch (e) {
  console.error(e.message);
  stop();
  process.exitCode = 1;
}
