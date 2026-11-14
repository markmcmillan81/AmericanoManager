// Tournament logic: who plays whom, standings, career stats. No UI code in here.
import { AMERICANO_CYCLES, BLOCK } from "./schedules.js";

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;

// Fixed-pairs round robins. Team k = slots 2k and 2k+1 (so Team 1 = slots 1&2, Team 2 = slots 3&4 ...).
const TEAM_CYCLES = {
  2: [[[0, 1]]],
  3: [[[0, 1]], [[1, 2]], [[0, 2]]], // each team sits out once every 3 rounds
  4: [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]],
};

export const teamSlots = (k) => [2 * k, 2 * k + 1];

export function validateSetup({ players, teams }) {
  const n = players.length;
  if (n < MIN_PLAYERS) return `Add at least ${MIN_PLAYERS} players.`;
  if (n > MAX_PLAYERS) return `Maximum ${MAX_PLAYERS} players.`;
  if (new Set(players.map((p) => p.trim().toLowerCase())).size !== n) return "Two players have the same name.";
  if (players.some((p) => !p.trim())) return "A player has no name.";
  if (teams === "fixed" && n % 2) return "Fixed pairs needs an even number of players (4, 6 or 8).";
  return null;
}

export function recommendedRounds(n, teams) {
  if (teams === "fixed") return { 4: 3, 6: 6, 8: 6 }[n] ?? 6;
  return { 4: 6, 5: 5, 6: 6, 7: 7, 8: 7 }[n] ?? 7;
}

// Round counts at which sit-outs are exactly even (and the rotation is at its fairest).
export function fairStops(n, teams, upTo = 21) {
  const step = teams === "fixed" ? (n === 6 ? 3 : 1) : BLOCK[n];
  const out = [];
  for (let r = step; r <= upTo; r += step) out.push(r);
  return out;
}

export function cycleInfo(n, teams) {
  if (teams === "fixed") return { length: TEAM_CYCLES[n / 2].length };
  return { length: AMERICANO_CYCLES[n].length };
}

// ---------- building rounds ----------
function fixedRound(n, teams, r) {
  if (teams === "individual") {
    const cyc = AMERICANO_CYCLES[n];
    return cyc[r % cyc.length].map(([a, b], i) => ({ court: i + 1, a: [...a], b: [...b], sa: null, sb: null }));
  }
  const cyc = TEAM_CYCLES[n / 2];
  return cyc[r % cyc.length].map(([x, y], i) => ({ court: i + 1, a: teamSlots(x), b: teamSlots(y), sa: null, sb: null }));
}

export function buildInitialRounds(t) {
  const n = t.players.length;
  if (t.format === "americano") {
    return Array.from({ length: t.totalRounds }, (_, r) => ({ matches: fixedRound(n, t.teams, r) }));
  }
  return [{ matches: fixedRound(n, t.teams, 0) }]; // Mexicano: round 1 from slots, the rest from standings
}

export const matchDone = (m) => Number.isFinite(m.sa) && Number.isFinite(m.sb);
export const roundDone = (round) => round.matches.every(matchDone);

export function sittingOut(t, round) {
  const on = new Set(round.matches.flatMap((m) => [...m.a, ...m.b]));
  return t.players.map((_, i) => i).filter((i) => !on.has(i));
}

// ---------- standings ----------
// A "unit" is a player (individual) or a team (fixed pairs).
export function units(t) {
  if (t.teams === "fixed") {
    return Array.from({ length: t.players.length / 2 }, (_, k) => ({
      id: k, slots: teamSlots(k), name: teamSlots(k).map((s) => t.players[s]).join(" & "),
    }));
  }
  return t.players.map((name, i) => ({ id: i, slots: [i], name }));
}

const unitOf = (t, slot) => (t.teams === "fixed" ? Math.floor(slot / 2) : slot);

export function standings(t, roundsToCount = t.rounds.length) {
  const table = units(t).map((u) => ({ ...u, mat: 0, w: 0, d: 0, l: 0, pf: 0, pa: 0, sat: 0 }));
  t.rounds.slice(0, roundsToCount).forEach((round) => {
    for (const m of round.matches) {
      if (!matchDone(m)) continue;
      const sides = [[m.a, m.sa, m.sb], [m.b, m.sb, m.sa]];
      for (const [side, mine, theirs] of sides) {
        const ids = [...new Set(side.map((s) => unitOf(t, s)))];
        for (const id of ids) {
          const row = table[id];
          row.mat++; row.pf += mine; row.pa += theirs;
          if (mine > theirs) row.w++; else if (mine < theirs) row.l++; else row.d++;
        }
      }
    }
    if (!roundDone(round)) return; // only count sit-outs for rounds actually played
    const on = new Set(round.matches.flatMap((m) => [...m.a, ...m.b]).map((s) => unitOf(t, s)));
    table.forEach((row) => { if (!on.has(row.id)) row.sat++; });
  });
  return rank(table);
}

function rank(rows) {
  return [...rows].sort((x, y) =>
    y.pf - x.pf || y.w - x.w || (y.pf - y.pa) - (x.pf - x.pa) || x.id - y.id
  ).map((r, i) => ({ ...r, pos: i + 1 }));
}

// ---------- Mexicano ----------
function partnerCounts(t) {
  const n = t.players.length;
  const P = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const round of t.rounds) for (const m of round.matches) {
    for (const [x, y] of [m.a, m.b]) { P[x][y]++; P[y][x]++; }
  }
  return P;
}

export function nextMexicanoRound(t) {
  const r = t.rounds.length;
  const table = standings(t);
  const n = t.players.length;
  const isFixed = t.teams === "fixed";
  const unitCount = isFixed ? n / 2 : n;
  const perMatch = isFixed ? 2 : 4;
  const playingUnits = Math.floor(unitCount / perMatch) * perMatch;
  const sitCount = unitCount - playingUnits;

  // Who sits: fewest sit-outs so far, then whoever sat longest ago, then rotate by slot.
  const lastSat = new Array(unitCount).fill(-1);
  t.rounds.forEach((round, ri) => {
    const on = new Set(round.matches.flatMap((m) => [...m.a, ...m.b]).map((s) => unitOf(t, s)));
    for (let u = 0; u < unitCount; u++) if (!on.has(u)) lastSat[u] = ri;
  });
  const sitters = new Set(
    [...table].sort((x, y) => x.sat - y.sat || lastSat[x.id] - lastSat[y.id] || ((x.id + r) % unitCount) - ((y.id + r) % unitCount))
      .slice(0, sitCount).map((u) => u.id)
  );
  const ranked = table.filter((u) => !sitters.has(u.id)); // already in ranking order

  const matches = [];
  if (isFixed) {
    for (let i = 0; i < ranked.length; i += 2) {
      matches.push({ court: matches.length + 1, a: teamSlots(ranked[i].id), b: teamSlots(ranked[i + 1].id), sa: null, sb: null });
    }
  } else {
    const P = partnerCounts(t);
    for (let i = 0; i < ranked.length; i += 4) {
      const g = ranked.slice(i, i + 4).map((u) => u.id); // ranks 1..4 within this court
      const options = [
        [[g[0], g[3]], [g[1], g[2]]], // classic Mexicano: 1&4 v 2&3
        [[g[0], g[2]], [g[1], g[3]]],
        [[g[0], g[1]], [g[2], g[3]]],
      ];
      // keep the classic pairing unless it repeats a partnership more than an alternative would
      const cost = ([a, b]) => P[a[0]][a[1]] + P[b[0]][b[1]];
      let best = options[0];
      for (const o of options) if (cost(o) < cost(best)) best = o;
      matches.push({ court: matches.length + 1, a: [...best[0]].sort((x, y) => x - y), b: [...best[1]].sort((x, y) => x - y), sa: null, sb: null });
    }
  }
  return { matches };
}

// ---------- who played with / against whom ----------
export function meetings(t) {
  const n = t.players.length;
  const P = Array.from({ length: n }, () => new Array(n).fill(0));
  const O = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const round of t.rounds) for (const m of round.matches) {
    for (const [x, y] of [m.a, m.b]) { P[x][y]++; P[y][x]++; }
    for (const i of m.a) for (const j of m.b) { O[i][j]++; O[j][i]++; }
  }
  return { P, O };
}

// ---------- career stats across tournaments ----------
export function winnersOf(t) {
  const table = standings(t);
  if (!table.length || !table[0].mat) return [];
  return table[0].slots.map((s) => t.players[s]);
}

// opts.exclude: Set of lower-case names — drop every match any of them played in.
// opts.from: "YYYY-MM-DD" — only tournaments on or after this date.
export function careerStats(tournaments, legacy = [], opts = {}) {
  const exclude = opts.exclude || new Set();
  const map = new Map();
  const row = (name) => {
    const key = name.trim().toLowerCase();
    if (!map.has(key)) map.set(key, { name: name.trim(), trn: 0, trnWin: 0, mat: 0, w: 0, d: 0, l: 0, pf: 0, pa: 0 });
    return map.get(key);
  };
  for (const L of legacy) {
    const r = row(L.name);
    for (const k of ["trn", "trnWin", "mat", "w", "d", "l", "pf", "pa"]) r[k] += L[k] || 0;
  }
  for (const t of tournaments) {
    if (t.status !== "finished") continue;
    if (opts.from && (t.date || "") < opts.from) continue;
    const playedHere = new Set();
    for (const round of t.rounds) for (const m of round.matches) {
      if (!matchDone(m)) continue;
      const names = [...m.a, ...m.b].map((s) => t.players[s]);
      if (names.some((n) => exclude.has(n.trim().toLowerCase()))) continue;
      for (const [side, mine, theirs] of [[m.a, m.sa, m.sb], [m.b, m.sb, m.sa]]) {
        for (const s of side) {
          const r = row(t.players[s]);
          playedHere.add(r);
          r.mat++; r.pf += mine; r.pa += theirs;
          if (mine > theirs) r.w++; else if (mine < theirs) r.l++; else r.d++;
        }
      }
    }
    playedHere.forEach((r) => r.trn++);
    if (!exclude.size) winnersOf(t).forEach((name) => row(name).trnWin++);
  }
  return [...map.values()];
}

// Every finished match as plain names: [{ date, tournament, a:[n,n], b:[n,n], sa, sb }]
export function allMatches(tournaments, opts = {}) {
  const out = [];
  for (const t of tournaments) {
    if (t.status !== "finished") continue;
    if (opts.from && (t.date || "") < opts.from) continue;
    t.rounds.forEach((round, ri) => round.matches.forEach((m) => {
      if (!matchDone(m)) return;
      out.push({ date: t.date, tournament: t.name, id: t.id, round: ri + 1, a: m.a.map((s) => t.players[s]), b: m.b.map((s) => t.players[s]), sa: m.sa, sb: m.sb });
    }));
  }
  return out.sort((x, y) => (y.date || "").localeCompare(x.date || "") || y.round - x.round);
}

const blank = () => ({ mat: 0, w: 0, d: 0, l: 0, pf: 0, pa: 0, recent: [] });
function add(rec, mine, theirs, m) {
  rec.mat++; rec.pf += mine; rec.pa += theirs;
  if (mine > theirs) rec.w++; else if (mine < theirs) rec.l++; else rec.d++;
  if (rec.recent.length < 6) rec.recent.push(m);
}

// Head to head for one player: how they do with and against everyone else.
export function headToHead(tournaments, player, opts = {}) {
  const me = player.trim().toLowerCase();
  const others = new Map(); // key -> { name, with, against }
  const get = (n) => {
    const k = n.trim().toLowerCase();
    if (!others.has(k)) others.set(k, { name: n.trim(), with: blank(), against: blank() });
    return others.get(k);
  };
  const overall = blank();
  for (const m of allMatches(tournaments, opts)) {
    const inA = m.a.some((n) => n.trim().toLowerCase() === me), inB = m.b.some((n) => n.trim().toLowerCase() === me);
    if (!inA && !inB) continue;
    const [mine, theirs, mySide, theirSide] = inA ? [m.sa, m.sb, m.a, m.b] : [m.sb, m.sa, m.b, m.a];
    add(overall, mine, theirs, m);
    for (const n of mySide) if (n.trim().toLowerCase() !== me) add(get(n).with, mine, theirs, m);
    for (const n of theirSide) add(get(n).against, mine, theirs, m);
  }
  return { overall, others: [...others.values()] };
}

export const matchPct = (r) => (r.mat ? Math.round((100 * (r.w + r.d / 2)) / r.mat) : 0);
export const ptsPct = (r) => (r.pf + r.pa ? Math.round((1000 * r.pf) / (r.pf + r.pa)) / 10 : 0);

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
