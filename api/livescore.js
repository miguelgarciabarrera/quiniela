import { get, put } from "@vercel/blob";

// Auto-relleno de "La Realidad" con el marcador en vivo de la API pública de ESPN
// (gratis, sin API key). Sólo toca partidos de eliminatoria (extra) que están en
// juego o recién terminados, y NO los sella: deja el marcador provisional para que
// un humano confirme y fije "se definió en" (que dispara el sellado normal).
const DOC_PATH = "quiniela/state.json";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";

// nombres del pool (ES) -> nombres de ESPN (EN). Sólo los que difieren; el resto
// se empareja por igualdad normalizada (sin acentos ni signos).
const EN = {
  "México": "Mexico", "Sudáfrica": "South Africa", "Corea del Sur": "South Korea",
  "Chequia": "Czechia", "Canadá": "Canada", "Bosnia y Herzegovina": "Bosnia-Herzegovina",
  "España": "Spain", "Cabo Verde": "Cape Verde", "Bélgica": "Belgium", "Egipto": "Egypt",
  "Arabia Saudita": "Saudi Arabia", "Irán": "Iran", "Nueva Zelanda": "New Zealand",
  "Brasil": "Brazil", "Japón": "Japan", "Francia": "France", "Suecia": "Sweden",
  "Alemania": "Germany", "Países Bajos": "Netherlands", "Marruecos": "Morocco",
  "Costa de Marfil": "Ivory Coast", "Noruega": "Norway", "Inglaterra": "England",
  "RD del Congo": "Congo DR", "Estados Unidos": "United States", "Croacia": "Croatia",
  "Suiza": "Switzerland", "Argelia": "Algeria", "Uzbekistán": "Uzbekistan",
  "Jordania": "Jordan", "Catar": "Qatar", "Panamá": "Panama",
};

const norm = (s) => String(s || "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const toEN = (name) => norm(EN[name] || name);

async function readDoc() {
  const result = await get(DOC_PATH, { access: "private", useCache: false });
  if (!result || !result.stream) return null;
  return JSON.parse(await new Response(result.stream).text());
}

async function fetchEspn() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(ESPN, { signal: ctrl.signal });
    const j = await r.json();
    return (j.events || []).map((e) => {
      const c = (e.competitions || [])[0] || {};
      const comps = c.competitors || [];
      const h = comps.find((x) => x.homeAway === "home") || {};
      const a = comps.find((x) => x.homeAway === "away") || {};
      return {
        state: e.status?.type?.state,          // pre | in | post
        period: e.status?.period,              // 1,2 = tiempos reglamentarios; 3+ = alargue/penales
        home: h.team?.displayName, away: a.team?.displayName,
        hs: parseInt(h.score, 10), as: parseInt(a.score, 10),
      };
    });
  } finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const dry = req.query?.dry === "1";
    const events = (await fetchEspn()).filter(
      (e) => (e.state === "in" || e.state === "post") &&
             Number.isFinite(e.hs) && Number.isFinite(e.as)
    );
    const doc = await readDoc();
    if (!doc || !doc.state) return res.status(200).json({ updated: [], note: "sin estado" });
    const st = doc.state;

    const updated = [];
    for (const m of st.extraMatches || []) {
      if (!m.extra) continue;
      const ev = events.find((e) => toEN(m.home) === norm(e.home) && toEN(m.away) === norm(e.away));
      if (!ev) continue;
      // no tocar si ya está sellado (marcador final humano-confirmado)
      const sealAt = (st.realitySealAt || {})[m.id];
      if (sealAt != null && Date.now() >= sealAt) continue;
      // en alargue/penales dejamos el marcador de los 90' quieto (lo fija el humano)
      if (ev.period && ev.period > 2) continue;
      const cur = (st.results || {})[m.id];
      if (cur && +cur[0] === ev.hs && +cur[1] === ev.as) continue; // sin cambios
      if (!dry) { st.results = st.results || {}; st.results[m.id] = [ev.hs, ev.as]; }
      updated.push({ id: m.id, num: m.num, match: `${m.home} ${ev.hs}-${ev.as} ${m.away}`, state: ev.state });
    }

    if (!updated.length) return res.status(200).json({ updated: [], rev: doc.rev });
    if (dry) return res.status(200).json({ dry: true, wouldUpdate: updated, rev: doc.rev });

    const newDoc = { rev: doc.rev + 1, state: st, savedAt: new Date().toISOString() };
    await put(DOC_PATH, JSON.stringify(newDoc), {
      access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
    });
    return res.status(200).json({ updated, rev: newDoc.rev });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err && err.message) });
  }
}
