// Prints partner / opponent / sit-out spreads for every player count and fails loudly
// if the rules are broken. Run: node tests/check-schedules.mjs
import { AMERICANO_CYCLES, BLOCK } from "../public/schedules.js";

let failures = 0;
const fail = (msg) => { failures++; console.log("  FAIL: " + msg); };

function tally(n, rounds) {
  const P = Array.from({ length: n }, () => new Array(n).fill(0));
  const O = Array.from({ length: n }, () => new Array(n).fill(0));
  const S = new Array(n).fill(0);
  for (const round of rounds) {
    const playing = new Set();
    for (const [[a, b], [c, d]] of round) {
      for (const s of [a, b, c, d]) {
        if (playing.has(s)) fail(`slot ${s + 1} on court twice in a round`);
        playing.add(s);
      }
      P[a][b]++; P[b][a]++; P[c][d]++; P[d][c]++;
      for (const i of [a, b]) for (const j of [c, d]) { O[i][j]++; O[j][i]++; }
    }
    for (let i = 0; i < n; i++) if (!playing.has(i)) S[i]++;
  }
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([P[i][j], O[i][j]]);
  const range = (arr) => `${Math.min(...arr)}–${Math.max(...arr)}`;
  return { partner: range(pairs.map((p) => p[0])), opp: range(pairs.map((p) => p[1])), sit: range(S), P, O, S };
}

for (const n of [4, 5, 6, 7, 8]) {
  const cyc = AMERICANO_CYCLES[n];
  console.log(`\n${n} players — cycle of ${cyc.length} rounds, sit-outs balance every ${BLOCK[n]} rounds`);
  for (let r = 1; r <= cyc.length; r++) {
    const t = tally(n, cyc.slice(0, r));
    const mark = r % BLOCK[n] === 0 ? " *" : "";
    console.log(`  after ${String(r).padStart(2)} rounds: partner ${t.partner}  opponent ${t.opp}  sat out ${t.sit}${mark}`);
  }
  const full = tally(n, cyc);
  // Hard rules
  if (n === 8 || n === 5 || n === 4) {
    if (full.partner !== "1–1") fail(`${n}: partners not exactly once`);
    if (full.opp !== "2–2") fail(`${n}: opponents not exactly twice`);
  }
  for (let r = BLOCK[n]; r <= cyc.length; r += BLOCK[n]) {
    const t = tally(n, cyc.slice(0, r));
    if (Math.min(...t.S) !== Math.max(...t.S)) fail(`${n}: sit-outs uneven after ${r} rounds`);
  }
  // nobody sits two in a row
  for (let r = 1; r < cyc.length; r++) {
    const sitA = new Set([...Array(n).keys()].filter((i) => !cyc[r - 1].flat(2).includes(i)));
    const sitB = [...Array(n).keys()].filter((i) => !cyc[r].flat(2).includes(i));
    if (sitB.some((i) => sitA.has(i))) console.log(`  note: a player sits rounds ${r} and ${r + 1} back to back`);
  }
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll schedule checks passed.");
process.exit(failures ? 1 : 0);
