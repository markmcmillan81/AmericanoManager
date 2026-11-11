// Searches for the best individual-Americano rotation for each player count (4–8)
// and writes public/schedules.js. Run: node tools/generate-schedules.mjs
//
// Each schedule uses "slots" 0..n-1 (shown in the app as 1..n). A round is a list of
// courts; a court is [[a,b],[c,d]] meaning a&b play against c&d. Anyone not on a court sits out.
//
// Goals (in priority order):
//   1. Sit-outs shared exactly evenly at the end of each "block" of rounds.
//   2. Partner everyone as evenly as possible (perfect = everyone once per cycle).
//   3. Face everyone as evenly as possible (perfect for 8 = everyone exactly twice).
//   4. Stay as fair as possible if you stop early (every prefix is scored too).
//   5. Nobody sits out two rounds in a row.
import { writeFileSync } from "node:fs";

const CONFIG = {
  4: { rounds: 3, block: 3 },   // 1 court, nobody sits. Perfect.
  5: { rounds: 5, block: 5 },   // 1 court, 1 sits per round. Perfect (each sits once).
  6: { rounds: 15, block: 3 },  // 1 court, 2 sit. Every 3 rounds everyone has sat once.
  7: { rounds: 14, block: 7 },  // 1 court, 3 sit. Every 7 rounds everyone has sat 3 times.
  8: { rounds: 7, block: 7 },   // 2 courts, nobody sits. Perfect (partner 1x, oppose 2x).
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function cost(n, perms, cfg) {
  const courts = Math.floor(n / 4);
  const P = Array.from({ length: n }, () => new Array(n).fill(0));
  const O = Array.from({ length: n }, () => new Array(n).fill(0));
  const S = new Array(n).fill(0);
  let total = 0;
  let prevSit = null;
  for (let r = 0; r < perms.length; r++) {
    const p = perms[r];
    for (let c = 0; c < courts; c++) {
      const [a, b, x, y] = p.slice(c * 4, c * 4 + 4);
      P[a][b]++; P[b][a]++; P[x][y]++; P[y][x]++;
      for (const i of [a, b]) for (const j of [x, y]) { O[i][j]++; O[j][i]++; }
    }
    const sit = new Set(p.slice(courts * 4));
    for (const s of sit) S[s]++;
    if (prevSit) for (const s of sit) if (prevSit.has(s)) total += 40;
    prevSit = sit;

    // prefix fairness: sum of squares is smallest when counts are spread evenly
    let sp = 0, so = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { sp += P[i][j] ** 2; so += O[i][j] ** 2; }
    total += sp * 1 + so * 0.4;

    const checkpoint = (r + 1) % cfg.block === 0 || r === perms.length - 1;
    if (checkpoint) {
      const meanS = S.reduce((a, b) => a + b, 0) / n;
      for (const s of S) total += 2000 * (s - meanS) ** 2;
      const pairs = (n * (n - 1)) / 2;
      let mp = 0, mo = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { mp += P[i][j]; mo += O[i][j]; }
      mp /= pairs; mo /= pairs;
      const outside = (v, m) => Math.max(0, Math.floor(m) - v) + Math.max(0, v - Math.ceil(m));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        total += 300 * (P[i][j] - mp) ** 2 + 120 * (O[i][j] - mo) ** 2;
        total += 6000 * outside(P[i][j], mp) + 2500 * outside(O[i][j], mo);
      }
    }
  }
  return total;
}

function search(n, cfg, restarts, iters, seed) {
  const rand = rng(seed);
  let best = null, bestCost = Infinity;
  for (let rs = 0; rs < restarts; rs++) {
    let perms = Array.from({ length: cfg.rounds }, () => {
      const a = [...Array(n).keys()];
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    });
    let cur = cost(n, perms, cfg);
    let T = 400;
    for (let it = 0; it < iters; it++) {
      const r = Math.floor(rand() * cfg.rounds);
      const i = Math.floor(rand() * n), j = Math.floor(rand() * n);
      if (i === j) continue;
      const p = perms[r];
      [p[i], p[j]] = [p[j], p[i]];
      const c = cost(n, perms, cfg);
      if (c <= cur || rand() < Math.exp((cur - c) / T)) cur = c;
      else [p[i], p[j]] = [p[j], p[i]];
      T *= 0.99997;
      if (T < 0.05) T = 0.05;
    }
    if (cur < bestCost) { bestCost = cur; best = perms.map((p) => p.slice()); }
  }
  return { perms: best, cost: bestCost };
}

function toRounds(n, perms) {
  const courts = Math.floor(n / 4);
  return perms.map((p) => {
    const round = [];
    for (let c = 0; c < courts; c++) {
      const [a, b, x, y] = p.slice(c * 4, c * 4 + 4);
      round.push([[a, b].sort((u, v) => u - v), [x, y].sort((u, v) => u - v)]);
    }
    return round;
  });
}

// Relabel so round 1 reads 1&4 v 2&3 (court 1) and 5&8 v 6&7 (court 2): familiar and tidy.
function canonicalise(n, rounds) {
  const map = new Array(n).fill(-1);
  // target layout per court: team1 = (k, k+3), team2 = (k+1, k+2)
  let k = 0;
  for (const [[a, b], [c, d]] of rounds[0]) {
    map[a] = k; map[b] = k + 3; map[c] = k + 1; map[d] = k + 2; k += 4;
  }
  for (let i = 0; i < n; i++) if (map[i] === -1) map[i] = k++;
  return rounds.map((round) =>
    round.map((court) => court.map((team) => team.map((s) => map[s]).sort((u, v) => u - v)))
  );
}

const only = process.argv.slice(2).map(Number);
let out = {};
try { out = (await import("../public/schedules.js")).AMERICANO_CYCLES; } catch {}
for (const n of [4, 5, 6, 7, 8]) {
  if (only.length && !only.includes(n)) continue;
  const cfg = CONFIG[n];
  const iters = n >= 6 ? 600000 : 60000;
  const { perms, cost: c } = search(n, cfg, n >= 6 ? 8 : 6, iters, 1000 + n);
  out[n] = canonicalise(n, toRounds(n, perms));
  console.log(`n=${n} rounds=${cfg.rounds} cost=${c.toFixed(1)}`);
}

const header = `// GENERATED by tools/generate-schedules.mjs — the fixed "slot" rotations for individual Americano.
// Slots are 0-based here (slot 0 is shown as "1" in the app).
// A round is a list of courts; a court is [[a,b],[c,d]] = a&b v c&d. Anyone not listed sits out.
// When a tournament runs longer than the cycle, the cycle repeats.
`;
writeFileSync(
  new URL("../public/schedules.js", import.meta.url),
  header + "export const AMERICANO_CYCLES = " + JSON.stringify(out) + ";\n" +
  "export const BLOCK = " + JSON.stringify(Object.fromEntries(Object.entries(CONFIG).map(([k, v]) => [k, v.block]))) + ";\n"
);
console.log("wrote public/schedules.js");
