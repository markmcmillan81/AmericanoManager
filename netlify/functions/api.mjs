// The app's tiny backend. Stores each tournament as one JSON record in Netlify Blobs.
// Anyone can read. Writing needs the organiser key (the ADMIN_KEY environment variable in Netlify).
import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  const adminKey = (globalThis.Netlify?.env?.get("ADMIN_KEY")) || process.env.ADMIN_KEY;
  const isAdmin = !!adminKey && req.headers.get("x-admin-key") === adminKey;
  const store = getStore({ name: "padel", consistency: "strong" });
  const parts = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [resource, id] = parts;

  try {
    if (resource === "auth") return isAdmin ? json({ ok: true }) : json({ error: "Wrong organiser key" }, 401);

    if (resource === "tournaments" && !id && req.method === "GET") {
      const { blobs } = await store.list({ prefix: "t/" });
      const all = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
      return json(all.filter(Boolean).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0)));
    }

    if (resource === "tournaments" && id) {
      if (!/^[\w-]{4,64}$/.test(id)) return json({ error: "Bad id" }, 400);
      const key = "t/" + id;
      if (req.method === "GET") {
        const t = await store.get(key, { type: "json" });
        return t ? json(t) : json({ error: "Not found" }, 404);
      }
      if (!isAdmin) return json({ error: "Organiser key needed" }, 401);
      if (req.method === "PUT") {
        const body = await req.json();
        if (!body || body.id !== id || !Array.isArray(body.players)) return json({ error: "Invalid tournament" }, 400);
        body.updatedAt = Date.now();
        await store.setJSON(key, body);
        return json({ ok: true, updatedAt: body.updatedAt });
      }
      if (req.method === "DELETE") {
        await store.delete(key);
        return json({ ok: true });
      }
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
};

export const config = { path: "/api/*" };
