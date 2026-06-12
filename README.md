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

Everything (picks, results, prophecies, player names) is stored in the browser's
localStorage on the machine that runs the pool. Use **Export JSON** for backups and
**Import JSON** to restore or move machines. No server, no accounts, no excuses.
