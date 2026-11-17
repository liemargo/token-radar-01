// Launch Radar (token-radar-01): a Node 22 program, standard library only.
//
// It reads the sealed snapshot from /input/snapshot.json (or --input), ranks
// the pre-token protocols with the comparables model in lib/model.ts, writes
// the board to /output/board.json, writes the dashboard's data to
// /output/data.js, copies dashboard/ and screenshots/ into /output, and
// writes /output/dossier.json with the vendored buildDossier, byte for byte
// as the gate rebuilds it. The program refuses to hand in a board or a file
// set the gate would refuse: it checks its own outputs first and exits 1.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9._-]+$/;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`launch radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

/** Every regular file under a directory, by relative path, dot-names refused. */
function listFiles(dir: string, prefix = ''): { rel: string; path: string; bytes: number }[] {
  const found: { rel: string; path: string; bytes: number }[] = [];
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const path = join(dir, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    const st = statSync(path);
    if (st.isDirectory()) found.push(...listFiles(path, rel));
    else if (st.isFile()) found.push({ rel, path, bytes: st.size });
  }
  return found;
}

/** The dashboard the gate will see: shape, caps and plain names, checked before copying. */
function dashboardIssue(): string | null {
  const files = listFiles(join(here, 'dashboard'));
  if (files.length === 0) return 'dashboard/ is empty';
  if (files.length > DASHBOARD_CAPS.max_files) return `dashboard/ holds ${files.length} files, over ${DASHBOARD_CAPS.max_files}`;
  const total = files.reduce((n, f) => n + f.bytes, 0);
  if (total > DASHBOARD_CAPS.max_bytes) return `dashboard/ holds ${total} bytes, over ${DASHBOARD_CAPS.max_bytes}`;
  const names = new Set(files.map((f) => f.rel));
  if (!names.has('index.html')) return 'dashboard/ holds no index.html';
  if (![...names].some((n) => n.endsWith('.css'))) return 'dashboard/ holds no .css file';
  if (![...names].some((n) => n.endsWith('.js'))) return 'dashboard/ holds no .js file';
  for (const f of files) {
    for (const part of f.rel.split('/')) {
      if (!PLAIN_NAME.test(part) || part.length > 128) return `dashboard/${f.rel}: a name is letters, digits and . _ -, at most 128 characters`;
    }
  }
  return null;
}

const dashIssue = dashboardIssue();
if (dashIssue !== null) {
  process.stderr.write(`launch radar: ${dashIssue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyTree(from: string, to: string): string[] {
  const copied: string[] = [];
  for (const f of listFiles(from)) {
    const target = join(to, f.rel);
    mkdirSync(join(target, '..'), { recursive: true });
    copyFileSync(f.path, target);
    copied.push(f.rel);
  }
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'))
  .filter((rel) => !rel.includes('/'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`launch radar: screenshots/ holds ${shots.length} images: hand in 3 or 4, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`launch radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `launch radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked\n` +
    `launch radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images) and dossier.json in ${out}\n`,
);
