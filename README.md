# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/liemargo/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/liemargo/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar ranks 227 pre-token protocols by implied value: each is priced from the market-cap/TVL multiple its own category's already-trading peers carry (winsorized, shrunk to the global median), adjusted for 7-day TVL growth, time tracked with no token, and chain reach. The board covers all 40 watchlist protocols, sets the trading set aside as the pricing evidence, and gives every row a seven-step farm plan with costs and times, in a self-contained dashboard (board, filters, per-protocol detail) that renders offline.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=rkd14ktt&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
