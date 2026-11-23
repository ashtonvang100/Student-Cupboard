import { useState, useRef } from "react";
import { config, getCatalog, request } from "./api";
import type { Product } from "./data";
export function Connection({
  onConnect,
}: {
  onConnect: (token: string, products: Product[]) => void;
}) {
  const [url, setUrl] = useState(
    config.apiBaseUrl ||
      (["localhost", "127.0.0.1"].includes(location.hostname) ? "/api" : ""),
  );
  const [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
          const base = new URL(url.trim(), location.origin);
          if (!base.pathname.replace(/\/$/, "").endsWith("/api"))
            throw new Error("The backend address must end in /api.");
          if (location.protocol === "https:" && base.protocol === "http:")
            throw new Error(
              "A hosted frontend needs an HTTPS backend. Use the local frontend for a local backend.",
            );
          const candidate = url.trim().replace(/\/$/, "");
          await request("/health", "", undefined, { baseUrl: candidate });
          const products = await getCatalog(token.trim(), undefined, candidate);
          config.apiBaseUrl = candidate;
          onConnect(token.trim(), products);
          setToken("");
        } catch (e) {
          setError(
            `${(e as Error).message} Check that the backend is running and reachable at this address.`,
          );
        } finally {
          lock.current = false;
          setBusy(false);
        }
      }}
    >
      <h2>Connect your backend</h2>
      <p>
        Enter the running API address and your personal staff token. A GitHub
        repository URL is not an API address. Connection settings and tokens
        stay in this session only.
      </p>
      <label className="field">
        Backend API address
        <input
          placeholder="https://your-backend.example/api"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          disabled={busy}
        />
      </label>
      <label className="field">
        Personal staff token
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
          disabled={busy}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Checking connection…" : "Connect and load inventory"}
      </button>
    </form>
  );
}
