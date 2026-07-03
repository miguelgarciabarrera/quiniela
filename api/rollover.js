import { get, put } from "@vercel/blob";

// Auto-rollover: cuando el día más reciente de eliminatorias tiene TODOS sus
// marcadores finales y sellados, agrega (en esqueleto) los partidos del siguiente
// día de fixture, tomados de la API pública de ESPN. NO escribe la reseña editorial
// (stat / récords / La Yapa): eso lo marca en state.needsEditorial para que un
// humano/Claude lo llene después. Idempotente: sólo agrega partidos nuevos y sólo
// cuando el frente está sellado, así que correrlo de más no hace daño.
//
// Trigger: Vercel Cron (ver vercel.json). Soporta ?dry=1 para simular sin escribir.
const DOC_PATH = "quiniela/state.json";
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const TZ = "America/Mexico_City"; // las fechas del pool se agrupan en hora de CDMX
const YEAR = 2026;

// ESPN (EN) -> pool (ES). Inverso de la tabla de livescore.js; los equipos que no
// aparecen aquí se guardan con el nombre de ESPN tal cual (coincide en la mayoría).
const ES = {
  "Mexico": "México", "South Africa": "Sudáfrica", "South Korea": "Corea del Sur",
  "Czechia": "Chequia", "Canada": "Canadá", "Bosnia-Herzegovina": "Bosnia y Herzegovina",
  "Spain": "España", "Cape Verde": "Cabo Verde", "Belgium": "Bélgica", "Egypt": "Egipto",
  "Saudi Arabia": "Arabia Saudita", "Iran": "Irán", "New Zealand": "Nueva Zelanda",
  "Brazil": "Brasil", "Japan": "Japón", "France": "Francia", "Sweden": "Suecia",
  "Germany": "Alemania", "Netherlands": "Países Bajos", "Morocco": "Marruecos",
  "Ivory Coast": "Costa de Marfil", "Norway": "Noruega", "England": "Inglaterra",
  "Congo DR": "RD del Congo", "United States": "Estados Unidos", "Croatia": "Croacia",
  "Switzerland": "Suiza", "Algeria": "Argelia", "Uzbekistan": "Uzbekistán",
  "Jordan": "Jordania", "Qatar": "Catar", "Panama": "Panamá",
};
const toES = (name) => ES[name] || name;

const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const EN_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const norm = (s) => String(s || "").toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const pairKey = (a, b) => [norm(a), norm(b)].sort().join("|"); // sin orden local/visita

// partes de fecha en CDMX
function cdmxParts(ms) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short",
  }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t)?.value;
  return { y: +g("year"), m: +g("month"), d: +g("day"), dow: EN_DOW.indexOf(g("weekday")) };
}
// "Vie 3 Jul" desde un epoch, en hora de CDMX
function fmtDate(ms) {
  const { m, d, dow } = cdmxParts(ms);
  return `${DOW[dow]} ${d} ${MES[m - 1]}`;
}
// "Vie 3 Jul" -> clave ordenable (m*100+d). Sólo Jun/Jul 2026, no cruza año.
function dateKey(str) {
  const mo = String(str || "").match(/(\d+)\s+([A-Za-zÁÉÍÓÚáéíóú]{3,})/);
  if (!mo) return null;
  const mi = MES.findIndex((x) => x.toLowerCase() === mo[2].slice(0, 3).toLowerCase());
  return mi < 0 ? null : (mi + 1) * 100 + (+mo[1]);
}

// etiqueta de ronda por número de partido (bracket fijo del Mundial 2026:
// #73–88 R32, #89–96 R16, #97–100 CF, #101–102 SF, #103 3er, #104 final).
function roundLabel(num) {
  if (num <= 88) return "32vos";
  if (num <= 96) return "16vos";
  if (num <= 100) return "8vos";
  if (num <= 102) return "semis";
  if (num === 103) return "3er lugar";
  return "final";
}

async function readDoc() {
  const r = await get(DOC_PATH, { access: "private", useCache: false });
  if (!r || !r.stream) return null;
  return JSON.parse(await new Response(r.stream).text());
}

// yyyymmdd (UTC) para pedirle a ESPN un día
function ymd(dt) {
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
}
async function fetchDay(yyyymmdd) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const j = await (await fetch(`${ESPN}?dates=${yyyymmdd}`, { signal: ctrl.signal })).json();
    return (j.events || []).map((e) => {
      const c = (e.competitions || [])[0] || {};
      const comps = c.competitors || [];
      const h = comps.find((x) => x.homeAway === "home") || {};
      const a = comps.find((x) => x.homeAway === "away") || {};
      return { id: e.id, ko: Date.parse(e.date), home: h.team?.displayName, away: a.team?.displayName };
    });
  } catch (e) { return []; }
  finally { clearTimeout(t); }
}

// ---- condición de sellado (espejo de la app) ----
function realityComplete(m, st) {
  const r = (st.results || {})[m.id];
  const ok = r && r[0] !== "" && r[0] != null && r[1] !== "" && r[1] != null;
  if (!ok) return false;
  // eliminatoria empatada: incompleta hasta saber quién ganó los penales
  if (+r[0] === +r[1] && !(st.penWinner || {})[m.id]) return false;
  return true;
}
function isSealed(m, st) {
  const at = (st.realitySealAt || {})[m.id];
  return at != null && Date.now() >= at;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const dry = req.query?.dry === "1";
    const doc = await readDoc();
    if (!doc || !doc.state) return res.status(200).json({ note: "sin estado" });
    const st = doc.state;
    const extra = st.extraMatches || [];
    if (!extra.length) return res.status(200).json({ note: "sin partidos de eliminatoria" });

    // 1) frente = grupo del día más reciente ya presente
    const keyed = extra.map((m) => ({ m, k: dateKey(m.date) })).filter((x) => x.k != null);
    const frontKey = Math.max(...keyed.map((x) => x.k));
    const front = keyed.filter((x) => x.k === frontKey).map((x) => x.m);

    // 2) compuerta: TODO el frente con marcador final y sellado
    const pending = front.filter((m) => !(realityComplete(m, st) && isSealed(m, st)));
    if (pending.length) {
      return res.status(200).json({
        note: "frente sin sellar", frontDate: front[0]?.date,
        waitingOn: pending.map((m) => ({ num: m.num, match: `${m.home} vs ${m.away}` })),
      });
    }

    // 3) buscar el siguiente día de fixture en ESPN (agrupado en CDMX), saltando
    //    días de descanso. Ventana: hasta 8 días después del frente.
    const anchor = new Date(Date.UTC(YEAR, Math.floor(frontKey / 100) - 1, frontKey % 100, 12));
    const seen = new Map(); // eventId -> {ko, home, away}
    for (let i = 0; i <= 8; i++) {
      const dt = new Date(anchor.getTime() + i * 86400000);
      for (const ev of await fetchDay(ymd(dt))) if (ev.ko && ev.home && ev.away) seen.set(ev.id, ev);
    }
    // regrupar por fecha local
    const byDay = new Map(); // dateStr -> [events]
    for (const ev of seen.values()) {
      const ds = fmtDate(ev.ko);
      (byDay.get(ds) || byDay.set(ds, []).get(ds)).push(ev);
    }
    const present = new Set(extra.map((m) => pairKey(m.home, m.away)));
    // primer día local estrictamente posterior al frente con algún partido nuevo
    const candidates = [...byDay.entries()]
      .map(([ds, evs]) => ({ ds, k: dateKey(ds), evs }))
      .filter((x) => x.k != null && x.k > frontKey && x.evs.some((e) => !present.has(pairKey(toES(e.home), toES(e.away)))))
      .sort((a, b) => a.k - b.k);

    if (!candidates.length) return res.status(200).json({ note: "no hay siguiente fixture aún", frontDate: front[0]?.date });

    const day = candidates[0];
    const fresh = day.evs
      .filter((e) => !present.has(pairKey(toES(e.home), toES(e.away))))
      .sort((a, b) => a.ko - b.ko);

    // 4) construir esqueletos
    let nextNum = Math.max(72, ...extra.map((m) => m.num || 0));
    const added = fresh.map((e, i) => {
      const num = ++nextNum;
      return {
        id: "x" + (Date.now() + i), num, date: day.ds, group: roundLabel(num),
        home: toES(e.home), away: toES(e.away), extra: true, ko: e.ko,
      };
    });

    if (dry) {
      return res.status(200).json({
        dry: true, wouldAdd: added.map((m) => ({ num: m.num, date: m.date, group: m.group, match: `${m.home} vs ${m.away}`, ko: new Date(m.ko).toISOString() })),
        rev: doc.rev,
      });
    }

    st.extraMatches = extra.concat(added);
    st.needsEditorial = (st.needsEditorial || []).concat(added.map((m) => m.id));

    const newDoc = { rev: doc.rev + 1, state: st, savedAt: new Date().toISOString() };
    await put(DOC_PATH, JSON.stringify(newDoc), {
      access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json",
    });
    return res.status(200).json({
      added: added.map((m) => ({ num: m.num, date: m.date, group: m.group, match: `${m.home} vs ${m.away}` })),
      needsEditorial: st.needsEditorial, rev: newDoc.rev,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err && err.message) });
  }
}
