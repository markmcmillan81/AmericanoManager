// Structured search for 6 and 7 players (one court, people sitting out).
// 6 players: sit-out pairs come from a 1-factorisation of K6, so every pair of players sits out
//   together exactly once in 15 rounds and every 3 rounds everyone has sat once.
// 7 players: sit-out triples are the 7 lines of the Fano plane, so every pair sits together once
//   per 7 rounds and everyone sits 3 times per 7 rounds.
// The search then chooses round order and who partners whom. Run: node tools/structured-6-7.mjs
import { readFileSync, writeFileSync } from "node:fs";

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const PAIRINGS = [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]]; // indexes into sorted 4 players

function roundsFrom(n, sitSets, pairing) {
  return sitSets.map((sit, r) => {
    const play = [...Array(n).keys()].filter((i) => !sit.includes(i));
    const [a, b, c, d] = PAIRINGS[pairing[r]].map((k) => play[k]);
    return [[[a, b].sort((x, y) => x - y), [c, d].sort((x, y) => x - y)]];
  });
}

function score(n, rounds, block) {
  const P = Array.from({ length: n }, () => new Array(n).fill(0));
  const O = Array.from({ length: n }, () => new Array(n).fill(0));
  let total = 0, prevSit = null;
  rounds.forEach((round, r) => {
    const playing = new Set();
    for (const [[a, b], [c, d]] of round) {
      [a, b, c, d].forEach((s) => playing.add(s));
      P[a][b]++; P[b][a]++; P[c][d]++; P[d][c]++;
      for (const i of [a, b]) for (const j of [c, d]) { O[i][j]++; O[j][i]++; }
    }
    const sit = new Set([...Array(n).keys()].filter((i) => !playing.has(i)));
    if (prevSit) for (const s of sit) if (prevSit.has(s)) total += 3;
    prevSit = sit;
    let sp = 0, so = 0, mp = 0, mo = 0;
    const pairs = (n * (n - 1)) / 2;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { sp += P[i][j] ** 2; so += O[i][j] ** 2; mp += P[i][j]; mo += O[i][j]; }
    total += sp + so * 0.4;
    mp /= pairs; mo /= pairs;
    const out = (v, m) => Math.max(0, Math.floor(m) - v) + Math.max(0, v - Math.ceil(m));
    // every prefix should keep counts within the ideal floor/ceil band; block ends matter most
    const w = (r + 1) % block === 0 ? 300 : 8;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) total += w * (3 * out(P[i][j], mp) + out(O[i][j], mo));
  });
  return total;
}

function anneal(n, block, buildSits, stateInit, mutate, iters, seed) {
  const rand = rng(seed);
  let state = stateInit(rand);
  let cur = score(n, roundsFrom(n, buildSits(state), state.pairing), block);
  let best = structuredClone(state), bestC = cur, T = 30;
  for (let it = 0; it < iters; it++) {
    const undo = mutate(state, rand);
    const c = score(n, roundsFrom(n, buildSits(state), state.pairing), block);
    if (c <= cur || rand() < Math.exp((cur - c) / T)) {
      cur = c;
      if (c < bestC) { bestC = c; best = structuredClone(state); }
    } else undo();
    T = Math.max(0.02, T * 0.99993);
  }
  return { rounds: roundsFrom(n, buildSits(best), best.pairing), cost: bestC };
}

const swapIn = (arr, rand) => {
  const i = Math.floor(rand() * arr.length), j = Math.floor(rand() * arr.length);
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return () => { [arr[i], arr[j]] = [arr[j], arr[i]]; };
};

// ---------- 6 players ----------
const K6 = [
  [[0, 1], [2, 3], [4, 5]], [[0, 2], [1, 4], [3, 5]], [[0, 3], [1, 5], [2, 4]],
  [[0, 4], [1, 3], [2, 5]], [[0, 5], [1, 2], [3, 4]],
];
function six(seed) {
  return anneal(6, 3,
    (s) => s.blockOrder.flatMap((b) => s.within[b].map((k) => K6[b][k])),
    () => ({ blockOrder: [0, 1, 2, 3, 4], within: K6.map(() => [0, 1, 2]), pairing: new Array(15).fill(0) }),
    (s, rand) => {
      const m = rand();
      if (m < 0.15) return swapIn(s.blockOrder, rand);
      if (m < 0.4) return swapIn(s.within[Math.floor(rand() * 5)], rand);
      const r = Math.floor(rand() * 15), old = s.pairing[r];
      s.pairing[r] = (old + 1 + Math.floor(rand() * 2)) % 3;
      return () => { s.pairing[r] = old; };
    }, 400000, seed);
}

// ---------- 7 players ----------
const FANO = [[0, 1, 3], [1, 2, 4], [2, 3, 5], [3, 4, 6], [4, 5, 0], [5, 6, 1], [6, 0, 2]];
function seven(seed) {
  return anneal(7, 7,
    (s) => [
      ...s.order1.map((k) => FANO[k]),
      ...s.order2.map((k) => FANO[k].map((p) => s.relabel[p])),
    ],
    () => ({ order1: [...Array(7).keys()], order2: [...Array(7).keys()], relabel: [...Array(7).keys()], pairing: new Array(14).fill(0) }),
    (s, rand) => {
      const m = rand();
      if (m < 0.15) return swapIn(s.order1, rand);
      if (m < 0.3) return swapIn(s.order2, rand);
      if (m < 0.45) return swapIn(s.relabel, rand);
      const r = Math.floor(rand() * 14), old = s.pairing[r];
      s.pairing[r] = (old + 1 + Math.floor(rand() * 2)) % 3;
      return () => { s.pairing[r] = old; };
    }, 400000, seed);
}

function bestOf(fn, tries) {
  let best = null;
  for (let t = 0; t < tries; t++) {
    const res = fn(77 + t * 31);
    if (!best || res.cost < best.cost) best = res;
  }
  return best;
}

// Relabel so round 1 reads 1&4 v 2&3 and the first sitters are the highest slots.
function canonicalise(n, rounds) {
  const map = new Array(n).fill(-1);
  const [[a, b], [c, d]] = rounds[0][0];
  map[a] = 0; map[b] = 3; map[c] = 1; map[d] = 2;
  let k = 4;
  for (let i = 0; i < n; i++) if (map[i] === -1) map[i] = k++;
  return rounds.map((round) => round.map((court) => court.map((t) => t.map((s) => map[s]).sort((x, y) => x - y))));
}

const file = new URL("../public/schedules.js", import.meta.url);
const mod = await import(file.href);
const cycles = { ...mod.AMERICANO_CYCLES };
const blocks = { ...mod.BLOCK, 6: 3, 7: 7 };
const r6 = bestOf(six, 10); console.log("6 players cost", r6.cost);
const r7 = bestOf(seven, 6); console.log("7 players cost", r7.cost);
cycles[6] = canonicalise(6, r6.rounds);
cycles[7] = canonicalise(7, r7.rounds);
const header = readFileSync(file, "utf8").split("export const")[0];
writeFileSync(file, header + "export const AMERICANO_CYCLES = " + JSON.stringify(cycles) + ";\n" +
  "export const BLOCK = " + JSON.stringify(blocks) + ";\n");
console.log("updated public/schedules.js");
