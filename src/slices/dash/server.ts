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
import { fetchChain, fetchCounts, fetchFact, fetchFacts, type DashQuery } from "./data.ts";
import { renderError, renderStats, renderTranslatedCard } from "./fragments.ts";
import { renderDetail } from "./detail.ts";
import { renderDraftBody, renderDraftDetail } from "./draft_fragments.ts";
import { fetchDraft, fetchDrafts, filterDrafts } from "./drafts.ts";
import { renderList } from "./listing.ts";
import { renderPage } from "./page.ts";

/** One display-only translation call (the slice never formats the prompt). */
export type TranslateText = (text: string) => Promise<{ text?: string; error?: string }>;

export interface DashServerOptions {
  /** Per-card translation. Absent → the route reports the reason instead of
   *  pretending it worked (a dashboard must not silently do nothing). */
  translate?: TranslateText;
}

/** Cap on the translate request body: a card's title + excerpt, with slack. */
const MAX_TRANSLATE_BODY = 16 * 1024;

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
    history: u.searchParams.has("history"),
  };
}

/** Reads a bounded request body; rejects (undefined) anything oversized. */
async function readFormBody(
  req: http.IncomingMessage,
  limit: number,
): Promise<URLSearchParams | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) return undefined;
    chunks.push(buf);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Two display translations in parallel (title, excerpt) so the card's shape is
 * preserved exactly. Falls back to the original text with the reason on any
 * failure — translation is a convenience, never a data transformation.
 */
async function translateCard(
  translate: TranslateText | undefined,
  title: string,
  excerpt: string,
): Promise<string> {
  if (!translate) {
    return renderTranslatedCard(title, excerpt, { error: "no model context in this session" });
  }
  const [titleResult, excerptResult] = await Promise.all<
    { text?: string; error?: string }
  >([
    translate(title),
    excerpt ? translate(excerpt) : Promise.resolve({}),
  ]);
  const error = titleResult.error ?? excerptResult.error;
  if (error) return renderTranslatedCard(title, excerpt, { error });
  return renderTranslatedCard(title, excerpt, {
    title: titleResult.text,
    excerpt: excerptResult.text,
  });
}

export async function startDashServer(
  cwd: string,
  options: DashServerOptions = {},
): Promise<DashServer> {
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
        // Display-only per-card translation. POST (not GET): the text being
        // translated travels in the body, never in a URL.
        if (pathname === "/frag/translate") {
          if (req.method !== "POST") {
            sendNotFound(res);
            return;
          }
          const form = await readFormBody(req, MAX_TRANSLATE_BODY);
          if (!form) {
            sendHtml(res, renderError("translate: request body too large"));
            return;
          }
          // Unchecking the toggle fires a change event too. Answer it with an
          // empty body and NO model call — the CSS toggle already reveals the
          // original text again, so a translation is only ever fetched once.
          if (!form.has("checked")) {
            sendHtml(res, "");
            return;
          }
          const title = (form.get("title") ?? "").slice(0, 2000);
          const excerpt = (form.get("excerpt") ?? "").slice(0, 4000);
          sendHtml(res, await translateCard(options.translate, title, excerpt));
          return;
        }
        if (pathname === "/frag/facts") {
          const query = readQuery(u);
          // Pending drafts are part of the list, not a separate view: they come
          // from the same chips and the same search box as the facts.
          const [facts, drafts] = await Promise.all([fetchFacts(cwd, query), fetchDrafts(cwd)]);
          if (!facts.ok) {
            sendHtml(res, renderError(facts.error));
            return;
          }
          const queue = drafts.ok ? drafts.value.drafts : [];
          sendHtml(
            res,
            renderList(facts.value, query, {
              drafts: filterDrafts(queue, query),
              total: queue.length,
              // A staging failure is a reason to trust this pane less; say so
              // instead of silently showing facts only.
              warning: drafts.ok ? drafts.value.warning : drafts.error,
            }),
          );
          return;
        }
        if (pathname.startsWith("/frag/fact/")) {
          const id = pathname.slice("/frag/fact/".length);
          const [fact, chain] = await Promise.all([fetchFact(cwd, id), fetchChain(cwd, id)]);
          if (!fact.ok) {
            sendHtml(res, renderError(fact.error));
            return;
          }
          // A missing chain is normal (a fact with no revisions yet).
          sendHtml(res, renderDetail(fact.value, chain.ok ? chain.value : undefined));
          return;
        }
        if (pathname.startsWith("/frag/draft/")) {
          const id = pathname.slice("/frag/draft/".length);
          const result = await fetchDraft(cwd, id);
          sendHtml(
            res,
            result.ok
              ? renderDraftDetail(result.value, renderDraftBody(result.value))
              : renderError(result.error),
          );
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
