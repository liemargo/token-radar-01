// Launch Radar's model: one sealed snapshot in, one ranked board out.
//
// The question the board answers is narrow: what would a protocol's token be
// worth if it issued one at the value its already-trading peers carry, given
// only the record the snapshot holds? The model never names a protocol. It
// prices every pre-token protocol from the snapshot's own figures:
//
//   peers      the protocols whose token already trades (mcap_usd present).
//              For each category, the median market-cap / TVL ratio of its
//              peers is that category's trading multiple, shrunk toward the
//              global median by the peer count so a thin category cannot
//              shout: multiple = (n x cat_median + 5 x global) / (n + 5),
//              clamped to [0.05, 3.0]. Each peer's own ratio is first
//              winsorized to [0.02, 20]: a protocol whose TVL print is a
//              stub of its real business would otherwise set the price.
//   implied    = tvl_usd x multiple(category)
//              x growth      1 + clamp(change_7d, -40, +60)% x 0.35
//              x maturity    0.70 + 0.30 x min(age_days, 1095) / 1095
//              x reach       1 + 0.02 x min(chains - 1, 10)
//
// Age is the days between listed_at and the snapshot's as_of; a protocol
// DefiLlama has tracked longer with no token has the longer record to price.
// The board carries every watchlist slug (the floor) plus the strongest
// rankable pre-token protocols below it, and keeps the trading set apart:
// their value is the market's, not a model's, so they are shown, not ranked.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard so a reader can re-run it. */
export const MODEL = {
  version: 'launch-radar-2',
  shrink_peers: 5,
  multiple_floor: 0.05,
  multiple_cap: 3.0,
  peer_min_tvl: 1_000_000,
  peer_ratio_floor: 0.02,
  peer_ratio_cap: 20,
  growth_floor: -40,
  growth_cap: 60,
  growth_weight: 0.35,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 300,
  reach_per_chain: 0.02,
  reach_max_extra_chains: 10,
  board_rows: 260,
  live_rows: 24,
} as const;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  tier: 'Watchlist' | 'Core' | 'Early';
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_peers: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
  };
  farm_steps: string[];
}

/** A trading protocol, set aside: the market already prices it. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  scanned: number;
  pre_token: number;
  set_aside: number;
  watchlist_size: number;
  board_size: number;
  global_multiple: number;
  constants: {
    growth_floor: number;
    growth_cap: number;
    growth_weight: number;
    maturity_floor: number;
    maturity_range: number;
    maturity_days: number;
    unknown_age_days: number;
    reach_per_chain: number;
    reach_max_extra_chains: number;
  };
  rows: BoardRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from listed_at to as_of, clamped at zero; null when untracked. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token when all three token fields are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const NOISE_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge']);

/**
 * Radar hygiene for the rows below the floor: an exchange is a company, a
 * bridge or wrapped/staked product rides on a token that already trades, and
 * a versioned name is one protocol's newer pool, not a launch of its own.
 * The watchlist is exempt: the house kept those, so the board carries them.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && NOISE_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Category trading multiples from the snapshot's own trading set. */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, { multiple: number; peers: number }>; global: number } {
  const ratios = (rows: SnapshotProtocol[]): number[] =>
    rows.filter((p) => p.mcap_usd !== null && p.tvl_usd >= MODEL.peer_min_tvl)
      .map((p) => Math.min(MODEL.peer_ratio_cap, Math.max(MODEL.peer_ratio_floor, p.mcap_usd! / p.tvl_usd)));
  const global = median(ratios(snapshot.protocols));
  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of snapshot.protocols) {
    if (p.category === null) continue;
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [category, rows] of groups) {
    const r = ratios(rows);
    if (r.length === 0) continue;
    const shrunk = (r.length * median(r) + MODEL.shrink_peers * global) / (r.length + MODEL.shrink_peers);
    byCategory.set(category, {
      multiple: Math.min(MODEL.multiple_cap, Math.max(MODEL.multiple_floor, shrunk)),
      peers: r.length,
    });
  }
  return { byCategory, global };
}

/** The factors and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiples: { byCategory: Map<string, { multiple: number; peers: number }>; global: number },
): { implied: number; multiple: number; peers: number; growthMult: number; maturityMult: number; reachMult: number; age: number | null } {
  const cat = p.category === null ? undefined : multiples.byCategory.get(p.category);
  const multiple = cat?.multiple ?? multiples.global;
  const peers = cat?.peers ?? 0;
  const growthPct = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, p.change_7d ?? 0));
  const growthMult = 1 + (growthPct / 100) * MODEL.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? MODEL.unknown_age_days;
  const maturityMult = MODEL.maturity_floor + (Math.min(Math.max(ageForModel, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const reachMult = 1 + MODEL.reach_per_chain * Math.min(Math.max(p.chains.length - 1, 0), MODEL.reach_max_extra_chains);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * reachMult));
  return { implied, multiple, peers, growthMult, maturityMult, reachMult, age };
}

// ---------------------------------------------------------------- farm plans
// Every plan is built from the protocol's own record: its category picks the
// actions, its main chain prices the gas, its TVL sizes the position, and
// its age sets the qualifying window. No plan names a step the record does
// not support, and every step states its cost and its time.

const L2_CHAINS = new Set(['Arbitrum', 'Base', 'Optimism', 'Scroll', 'Linea', 'zkSync Era', 'Mantle', 'Blast', 'Mode', 'Taiko', 'Polygon', 'Avalanche', 'BSC', 'Binance', 'Gnosis', 'Fantom', 'Sonic']);

/** A plain-language gas range for the chain a position lives on. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return '$10 to $30 of ETH in gas per transaction';
  if (chain === 'Solana') return 'under $0.05 of SOL in fees per transaction';
  if (chain === 'Bitcoin') return '$1 to $6 of BTC in fees per transaction';
  if (L2_CHAINS.has(chain)) return '$0.10 to $1.50 of gas per transaction';
  return '$0.50 to $4 of gas per transaction';
}

/** Position size by the protocol's TVL: deep enough to count, small enough to repeat. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 2000;
  if (p.tvl_usd >= 250_000_000) return 1000;
  if (p.tvl_usd >= 50_000_000) return 500;
  if (p.tvl_usd >= 10_000_000) return 250;
  return 100;
}

/** The qualifying window: younger protocols are farmed longer before judging. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The two category actions of a plan: open the position, then work it. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return [
    `Supply $${capital} of USDC (or ETH on ${chain}) as collateral in ${n}'s main market and leave it supplied.`,
    `Borrow about 20% of the supplied value against the position, hold the borrowed funds for two weeks, then repay in full so the account shows a complete borrow cycle.`,
  ];
  if (c.includes('dex') || c.includes('swap')) return [
    `Provide $${capital} of liquidity to ${n}'s deepest USDC pair on ${chain}, in the default range, and keep the position open.`,
    `Route one swap of about $${Math.max(25, Math.round(capital / 10))} through ${n} itself each week rather than an aggregator, so the volume is credited to your wallet.`,
  ];
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return [
    `Deposit $${capital} of USDC as margin on ${n} and open one small position (under 2x) that you are content to hold.`,
    `Trade to a steady weekly volume of about $${capital} notional in small hedged orders instead of one large trade, and keep the margin ratio above 50%.`,
  ];
  if (c.includes('staking') || c.includes('restak') || c.includes('curator') || c.includes('allocator') || c.includes('yield') || c.includes('farming')) return [
    `Deposit $${capital} into ${n}'s flagship vault or staking pool on ${chain} and keep the vault shares in the same wallet.`,
    `Claim and re-deposit any rewards the position earns each month, and vote in the vault's gauge or curator elections whenever one is open.`,
  ];
  if (c.includes('bridge')) return [
    `Bridge $${capital} of USDC from Ethereum to ${chain} through ${n}, and keep the bridged funds working on the far side.`,
    `Make one return or onward bridge of about $${Math.max(25, Math.round(capital / 10))} every two weeks so the wallet shows repeated, two-way use.`,
  ];
  if (c.includes('rwa') || c.includes('real world')) return [
    `Subscribe $${capital} to ${n}'s yield-bearing asset on ${chain}, completing the attestation or allowlist step its app asks for, and hold the asset.`,
    `Hold through at least two full distribution or reporting periods, and keep the statements the app issues for each one.`,
  ];
  if (c.includes('prediction')) return [
    `Fund the account with $${capital} and take one position in ${n}'s most liquid market at a price you have an actual view on.`,
    `Trade in at least three separate weeks, in small size, rather than placing the whole amount on one event.`,
  ];
  if (c.includes('insurance')) return [
    `Buy $${capital} of cover from ${n} against a position you genuinely hold, for the longest term its app offers.`,
    `Stake a further $${Math.max(25, Math.round(capital / 5))} in the underwriting pool if ${n} offers one, and leave it through the cover period.`,
  ];
  if (c.includes('stable')) return [
    `Mint or deposit $${capital} of ${n}'s stable asset on ${chain} from its own app, and hold the minted balance.`,
    `Use the stable asset in one of the integrations ${n} lists on its own page, so the wallet shows the asset at work, not just held.`,
  ];
  return [
    `Deposit $${capital} of USDC into ${n}'s core product on ${chain} from its own app and keep the position open.`,
    `Repeat the product's main action (a deposit, a trade or a vote) in small size every week, from the same wallet, so the history is steady rather than one burst.`,
  ];
}

/** A step as one string: the action, then its cost and time. */
function step(text: string, cost: string, time: string): string {
  return `${text} Cost: ${cost}. Time: ${time}.`;
}

/** One protocol's seven-step farm plan, from its record alone. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const [open, work] = actionsFor(p, capital, chain);
  return [
    step(`Open a fresh wallet for ${p.name} alone and fund it with $${capital} of working capital plus gas money on ${chain}; keep the seed phrase offline and never farm from your main wallet`,
      'the capital itself, plus a small gas float', '20 minutes to set up'),
    step(open, `$${capital} of capital and ${gas}`, '15 minutes'),
    step(work, 'interest, spread or slippage of roughly 0.1 to 0.5% of the amount used', '20 minutes, then 5 minutes a week'),
    step(`Keep one qualifying action a week for the whole window: a deposit, a swap, a vote or a claim on ${chain}, always from the same wallet`,
      gas.replace('per transaction', 'per week'), `10 minutes a week for ${hold} days`),
    step(`Hold the position for at least ${hold} days so it appears in several weekly snapshots, and check ${p.name}'s own points or rewards page once a month, claiming only from a link that page publishes`,
      'no fee to check; never pay anyone to claim', '10 minutes a month'),
    step(`Take part in ${p.name}'s governance and community: vote in its Snapshot or forum polls when they open and keep the wallet's votes consistent with the position you hold`,
      'nothing but attention', '15 minutes when a vote is open'),
    step(`To exit, unwind in reverse: repay any borrow, remove liquidity, then withdraw to the funding wallet, and keep a farm log of the wallet, the dates and every transaction hash`,
      `${gas} to close`, '30 minutes'),
  ];
}

// ---------------------------------------------------------------- the board

/** The ranked board: the watchlist whole, then the strongest rankable rest. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const multiples = categoryMultiples(snapshot);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const extras = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ p, implied: impliedValue(p, snapshot.as_of, multiples).implied }))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, Math.max(0, MODEL.board_rows - chosen.size));
  for (const e of extras) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples);
    const onWatchlist = snapshot.watchlist.includes(p.slug);
    return {
      p, ...v, onWatchlist,
      tier: (onWatchlist ? 'Watchlist' : p.tvl_usd >= snapshot.floor_usd ? 'Core' : 'Early') as BoardRow['tier'],
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    watchlist: s.onWatchlist,
    tier: s.tier,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.multiple),
      category_peers: s.peers,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      reach_multiplier: round4(s.reachMult),
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** The trading set, by market cap, shown apart from the ranked board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, MODEL.live_rows)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** The board plus everything the dashboard renders. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot);
  const multiples = categoryMultiples(snapshot);
  const preToken = snapshot.protocols.filter(isPreToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL.version,
    scanned: snapshot.protocols.length,
    pre_token: preToken,
    set_aside: snapshot.protocols.length - preToken,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    global_multiple: round4(multiples.global),
    constants: {
      growth_floor: MODEL.growth_floor,
      growth_cap: MODEL.growth_cap,
      growth_weight: MODEL.growth_weight,
      maturity_floor: MODEL.maturity_floor,
      maturity_range: MODEL.maturity_range,
      maturity_days: MODEL.maturity_days,
      unknown_age_days: MODEL.unknown_age_days,
      reach_per_chain: MODEL.reach_per_chain,
      reach_max_extra_chains: MODEL.reach_max_extra_chains,
    },
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's seven rows. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (typeof r.name !== 'string' || r.name === '') return `${r.slug} has no name`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
