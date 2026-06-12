import { get, put, list, del } from "@vercel/blob";

// One shared pool document, stored as a private blob. Shape:
//   { rev: number, state: <quiniela state>, savedAt: ISO string }
// Writers must send the rev they based their edit on; a stale rev gets a 409
// with the current document so the client can refresh instead of clobbering.
const DOC_PATH = "quiniela/state.json";
const HISTORY_PREFIX = "quiniela/history/";
const HISTORY_KEEP = 30;

async function readDoc() {
  const result = await get(DOC_PATH, { access: "private", useCache: false });
  if (!result || !result.stream) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const doc = await readDoc();
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(doc || { rev: 0, state: null, savedAt: null });
    }

    if (req.method === "POST") {
      const { baseRev, state } = req.body || {};
      if (typeof baseRev !== "number" || !state || !Array.isArray(state.players)) {
        return res.status(400).json({ error: "Expected { baseRev: number, state: { players: [...] } }" });
      }

      const current = await readDoc();
      if (current && baseRev !== current.rev) {
        return res.status(409).json(current);
      }

      const doc = { rev: (current ? current.rev : 0) + 1, state, savedAt: new Date().toISOString() };
      const body = JSON.stringify(doc);
      await put(DOC_PATH, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
      // history snapshots double as backups; pruned occasionally below
      await put(`${HISTORY_PREFIX}rev-${String(doc.rev).padStart(6, "0")}.json`, body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      });
      if (doc.rev % 20 === 0) {
        const { blobs } = await list({ prefix: HISTORY_PREFIX, limit: 1000 });
        const stale = blobs
          .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
          .slice(HISTORY_KEEP)
          .map(b => b.url);
        if (stale.length) await del(stale);
      }

      return res.status(200).json({ rev: doc.rev, savedAt: doc.savedAt });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Storage error", detail: String(err && err.message) });
  }
}
