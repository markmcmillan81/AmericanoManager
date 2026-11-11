// Runs the whole app on your laptop: the web pages plus the real /api function, with a
// local copy of Netlify's storage in the .local-data folder. Run: npm run local
// Your phone can open it too (same Wi-Fi) using the "On your phone" address printed below.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { BlobsServer } from "@netlify/blobs/server";

const root = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8888);

// read ADMIN_KEY from .env (or the environment)
if (existsSync(join(root, ".env"))) {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (!process.env.ADMIN_KEY) { process.env.ADMIN_KEY = "change-me"; }

const token = "local-token";
const blobs = new BlobsServer({ directory: join(root, ".local-data"), token });
const { port: blobsPort } = await blobs.start();
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({
  edgeURL: `http://localhost:${blobsPort}`, uncachedEdgeURL: `http://localhost:${blobsPort}`, siteID: "local", token,
})).toString("base64");

const { default: handler } = await import(new URL("../netlify/functions/api.mjs", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const response = await handler(request, {});
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path.endsWith("/")) path += "index.html";
    const file = join(root, "public", path);
    if (!file.startsWith(join(root, "public")) || !(await stat(file).catch(() => null))?.isFile()) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(await readFile(file));
  } catch (err) {
    res.writeHead(500); res.end(String(err));
  }
}).listen(PORT, "0.0.0.0", () => {
  const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  console.log(`\n  Padel Spot is running.\n`);
  console.log(`  On this laptop:  http://localhost:${PORT}`);
  if (lan) console.log(`  On your phone:   http://${lan}:${PORT}   (same Wi-Fi)`);
  console.log(`  Organiser key:   ${process.env.ADMIN_KEY}   (set in the .env file)`);
  console.log(`\n  Press Ctrl+C to stop.\n`);
});
