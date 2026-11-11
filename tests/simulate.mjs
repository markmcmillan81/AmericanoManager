// Plays every combination of format / team mode / player count with random scores and
// checks the rules hold. Run: node tests/simulate.mjs
import {
  buildInitialRounds, nextMexicanoRound, standings, careerStats, recommendedRounds, validateSetup, cycleInfo, meetings, sittingOut, roundDone,
} from "../public/scheduler.js";

let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log("  FAIL:", msg); } };
const names = ["Ann", "Bob", "Cat", "Dan", "Eve", "Fay", "Gus", "Hal"];

const tournaments = [];
for (const format of ["americano", "mexicano"]) for (const teams of ["individual", "fixed"]) for (let n = 4; n <= 8; n++) {
  const players = names.slice(0, n);
  const err = validateSetup({ players, teams });
  if (teams === "fixed" && n % 2) { check(!!err, `fixed pairs should reject ${n} players`); continue; }
  check(!err, `${format}/${teams}/${n} rejected: ${err}`);
  const totalRounds = recommendedRounds(n, teams);
  const t = { id: "x", name: "t", date: "2026-11-11", format, teams, scoring: { unit: "points", target: 24, fixedTotal: true }, players, totalRounds, status: "live", rounds: [] };
  t.rounds = buildInitialRounds(t);
  let r = 0;
  while (true) {
    const round = t.rounds[r];
    const seen = new Set();
    for (const m of round.matches) {
      for (const s of [...m.a, ...m.b]) { check(!seen.has(s), `${format}/${teams}/${n} r${r + 1}: slot twice`); seen.add(s); }
      if (teams === "fixed") check(Math.floor(m.a[0] / 2) === Math.floor(m.a[1] / 2) && Math.floor(m.b[0] / 2) === Math.floor(m.b[1] / 2), "fixed pair split up");
      m.sa = Math.floor(Math.random() * 25); m.sb = 24 - m.sa;
    }
    check(round.matches.length === Math.floor(n / 4) || teams === "fixed", "wrong court count");
    if (!roundDone(round)) check(false, "round not done");
    r++;
    if (r >= totalRounds) break;
    if (format === "mexicano") t.rounds.push(nextMexicanoRound(t));
  }
  check(t.rounds.length === totalRounds, `${format}/${teams}/${n}: ${t.rounds.length} rounds, expected ${totalRounds}`);
  const table = standings(t);
  const totalPf = table.reduce((a, x) => a + x.pf, 0), totalPa = table.reduce((a, x) => a + x.pa, 0);
  check(totalPf === totalPa, "points for != points against");
  for (let i = 1; i < table.length; i++) check(table[i - 1].pf >= table[i].pf, "standings not sorted");
  const sat = table.map((x) => x.sat);
  const { P, O } = meetings(t);
  let maxP = 0, maxO = 0, minO = 99;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) { maxP = Math.max(maxP, P[i][j]); maxO = Math.max(maxO, O[i][j]); minO = Math.min(minO, O[i][j]); }
  console.log(`${format.padEnd(9)} ${teams.padEnd(10)} ${n} players, ${String(totalRounds).padStart(2)} rounds | sat ${Math.min(...sat)}–${Math.max(...sat)} | max partner ${maxP} | opponents ${minO}–${maxO} | winner ${table[0].name} ${table[0].pf}`);
  if (format === "americano" && teams === "individual" && totalRounds <= cycleInfo(n, teams).length) {
    check(maxP <= 1, "americano: someone partnered twice in the default length");
    check(maxO <= 3, "americano: someone faced the same player more than 3 times");
  }
  if (format === "americano" && teams === "individual" && n === 8) check(minO === 2 && maxO === 2 && maxP === 1, "8-player americano not perfect");
  if (format === "mexicano") check(Math.max(...sat) - Math.min(...sat) <= 1, "mexicano sit-outs uneven by more than 1");
  t.status = "finished";
  tournaments.push(JSON.parse(JSON.stringify(t)));
}

const stats = careerStats(tournaments, [{ name: "ann", trn: 2, trnWin: 1, mat: 10, w: 5, d: 1, l: 4, pf: 200, pa: 180 }]);
const ann = stats.find((s) => s.name.toLowerCase() === "ann");
check(ann.trn === tournaments.length + 2, "career: legacy tournaments not added / name case not merged");
const totalW = stats.reduce((a, s) => a + s.w, 0) - 5, totalL = stats.reduce((a, s) => a + s.l, 0) - 4;
check(totalW === totalL, "career: wins and losses don't balance");

console.log(fails ? `\n${fails} FAILURE(S)` : "\nAll simulation checks passed.");
process.exit(fails ? 1 : 0);
