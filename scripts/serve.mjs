#!/usr/bin/env node
/**
 * Serves the static export in `out/`. Nothing else: there is no API, no upload path and
 * no request body is ever read, so a deployment that runs this server cannot receive
 * deal data even by mistake. Use it where the host wants a start command rather than a
 * static output directory.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "..", "out");
const policy = JSON.parse(readFileSync(resolve(here, "..", "security-headers.json"), "utf8"));

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

const SECURITY_HEADERS = {
  ...policy.headers,
  "Content-Security-Policy": [...policy.contentSecurityPolicy, ...policy.headerOnlyDirectives].join("; "),
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

if (!existsSync(join(root, "index.html"))) {
  console.error("out/index.html was not found. Run `npm run build` first.");
  process.exit(1);
}

function cacheControl(urlPath, extension) {
  if (urlPath.startsWith("/_next/static/")) return "public, max-age=31536000, immutable";
  if (extension === ".html" || extension === ".txt") return "no-cache";
  return "public, max-age=3600";
}

/** Maps a request path to a file inside `out/`, or null. Never resolves outside the root. */
function locate(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const target = normalize(join(root, decoded));
  if (target !== root && !target.startsWith(root + sep)) return null;

  const stat = statSync(target, { throwIfNoEntry: false });
  if (stat?.isFile()) return { file: target };
  if (stat?.isDirectory()) {
    const index = join(target, "index.html");
    if (!existsSync(index)) return null;
    return decoded.endsWith("/") ? { file: index } : { redirect: `${urlPath}/` };
  }
  return null;
}

function send(response, status, headers, body) {
  response.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  response.end(body);
}

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    request.resume();
    send(response, 405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, "Method not allowed\n");
    return;
  }

  const urlPath = (request.url ?? "/").split("?")[0] || "/";
  const found = locate(urlPath);

  if (found?.redirect) {
    send(response, 308, { Location: found.redirect, "Cache-Control": "no-cache" });
    return;
  }

  const file = found?.file ?? join(root, "404.html");
  const status = found?.file ? 200 : 404;
  const extension = extname(file);
  const size = statSync(file, { throwIfNoEntry: false })?.size;
  if (size === undefined) {
    send(response, 404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, "Not found\n");
    return;
  }

  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": TYPES[extension] ?? "application/octet-stream",
    "Content-Length": size,
    "Cache-Control": status === 200 ? cacheControl(urlPath, extension) : "no-store",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file)
    .on("error", () => response.destroy())
    .pipe(response);
});

server.listen(port, host, () => {
  console.log(`Autheo Close Desk: serving ${root} on ${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
