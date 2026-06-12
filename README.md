# ⚽ Quiniela Mundial 2026

World Cup 2026 prediction pool for five brave experts with zero coaching licenses:
Emilio, Ulises, Daniel, Diego and Miguel.

## Rules

- Every player predicts the score of every match (winner is implied by the score — draws count).
- 🎯 Exact score: **5 pts**
- 🤏 Correct winner (or draw) but wrong score: **3 pts**
- 💀 Miss: **0 pts**
- Before the group stage ends, each player locks in a **👑 World Champion** and a
  **🐴 Dark horse** (a team that goes deep without necessarily winning). Bragging rights only — for now.
- Last place buys the carnitas. House rules. 🌮

## Running it

```
npm install
npm run dev      # http://localhost:5174
npm run share    # expose on your LAN so the boys can look at it
npm run build    # static site in dist/ — host it anywhere
```

All 72 group-stage matches are pre-loaded with the real 2026 fixture list.
Knockout matches get added with the **＋ Add match** button as the bracket fills in.

## Data

The pool lives in the cloud: a Vercel serverless function (`api/state.js`) stores one
shared state document in a private Vercel Blob store, so everyone who opens the site
sees the same picks, results and leaderboard. Each save bumps a revision number —
if two people save at once, the second one gets refreshed to the latest version
instead of silently overwriting it. The last 30 revisions are kept as automatic
backups in the blob store.

The browser's localStorage doubles as an instant-load cache and offline fallback
(the header chip shows ☁️ synced / 📴 offline). **Export JSON** still works for manual
backups and **Import JSON** pushes a backup to the cloud for everyone.

Deployed on Vercel: `npx vercel --prod` ships a new version. Running locally with
`npm run dev` has no `/api`, so it falls back to offline/local-only mode — use
`npx vercel dev` if you want the API locally.
