/**
 * node:http server for /uma dash (Proposal 10).
 *
 * Single-process, loopback-only (127.0.0.1, OS-assigned port), token-gated.
 * Every request must carry `?t=<token>` or the `x-uma-token` header; a
 * mismatch gets a bare 404 so the surface stays invisible without the URL.
 * The only exceptions are `/assets/*` — <link>/<script> tags cannot send
 * custom headers, and they carry only the vendored static files, never
 * memory data.
 *
 * No fact data is cached between requests: each fragment call re-runs the
 * `uma` CLI (~70 ms locally) so the dashboard always shows the live store.
 */

import * as http from "node:http";
import type { Socket } from "node:net";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCounts, fetchFact, fetchFacts, type DashQuery } from "./data.ts";
import { renderDetail, renderError, renderFacts, renderStats } from "./fragments.ts";
import { renderPage } from "./page.ts";

export interface DashServer {
  port: number;
  token: string;
  url: string;
  /** Stops listening and destroys open keep-alive sockets. */
  close: () => Promise<void>;
}

const ASSET_TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function assetsDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");
}

function sendHtml(res: http.ServerResponse, body: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function sendNotFound(res: http.ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end("not found");
}

/** Serves a static file from assets/; path traversal is rejected. */
function sendAsset(res: http.ServerResponse, pathname: string): void {
  const root = assetsDir();
  const rel = pathname.slice("/assets/".length);
  const filePath = path.normalize(path.join(root, rel));
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendNotFound(res);
    return;
  }
  const type = ASSET_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(filePath).pipe(res);
}

function readQuery(u: URL): DashQuery {
  return {
    q: u.searchParams.get("q") ?? "",
    type: u.searchParams.get("type") ?? "",
    scope: u.searchParams.get("scope") ?? "",
    offset: Math.max(0, Number.parseInt(u.searchParams.get("offset") ?? "0", 10) || 0),
  };
}

export async function startDashServer(cwd: string): Promise<DashServer> {
  const token = randomBytes(16).toString("hex");
  const sockets = new Set<Socket>();

  const server = http.createServer((req, res) => {
    void (async (): Promise<void> => {
      try {
        const u = new URL(req.url ?? "/", "http://127.0.0.1");
        const pathname = decodeURIComponent(u.pathname);

        // Static vendor assets carry no memory data and cannot send the
        // token header from <link>/<script> tags — they are exempt.
        if (pathname.startsWith("/assets/")) {
          sendAsset(res, pathname);
          return;
        }

        const hasToken =
          u.searchParams.get("t") === token || req.headers["x-uma-token"] === token;
        if (!hasToken) {
          sendNotFound(res);
          return;
        }

        if (pathname === "/" || pathname === "/index.html") {
          sendHtml(res, renderPage(token));
          return;
        }
        if (pathname === "/frag/facts") {
          const query = readQuery(u);
          const result = await fetchFacts(cwd, query);
          sendHtml(res, result.ok ? renderFacts(result.value, query) : renderError(result.error));
          return;
        }
        if (pathname.startsWith("/frag/fact/")) {
          const id = pathname.slice("/frag/fact/".length);
          const result = await fetchFact(cwd, id);
          sendHtml(res, result.ok ? renderDetail(result.value) : renderError(result.error));
          return;
        }
        if (pathname === "/frag/stats") {
          const result = await fetchCounts(cwd);
          sendHtml(res, result.ok ? renderStats(result.value) : renderError(result.error));
          return;
        }
        sendNotFound(res);
      } catch {
        // Last-resort guard: the handler must never throw into node:http.
        try {
          sendHtml(res, renderError("internal dashboard error"));
        } catch {
          res.destroy();
        }
      }
    })();
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}/?t=${token}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
