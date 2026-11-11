import {
  MIN_PLAYERS, MAX_PLAYERS, validateSetup, recommendedRounds, fairStops, cycleInfo, buildInitialRounds,
  matchDone, roundDone, sittingOut, standings, nextMexicanoRound, meetings, winnersOf, careerStats, shuffle,
} from "./scheduler.js";

// ============ state ============
const $app = document.getElementById("app");
const $modal = document.getElementById("modal-root");
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const S = {
  adminKey: LS.get("pm.adminKey", ""),
  tournaments: LS.get("pm.cache", []),
  pending: LS.get("pm.pending", {}), // edits not yet saved to the server, keyed by id
  legacy: [],
  includeLegacy: LS.get("pm.includeLegacy2", false),
  loaded: false,
  serverOk: null,
  draft: null,
  swapSel: null,
  statsSort: LS.get("pm.statsSort", { key: "trnWin", dir: -1 }),
};
const isAdmin = () => !!S.adminKey;

// ============ helpers ============
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmtDate = (d) => { try { return new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); } catch { return d; } };
const names = (t, slots) => slots.map((s) => esc(t.players[s])).join(" &amp; ");
const findT = (id) => S.tournaments.find((t) => t.id === id);
function toast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), ms);
}
function describe(t) {
  const fmt = t.format === "mexicano" ? "Mexicano" : "Americano";
  const tm = t.teams === "fixed" ? "fixed pairs" : "individual";
  const sc = t.scoring.unit === "games" ? `${t.scoring.target} games` : `${t.scoring.target} points`;
  return `${fmt} · ${tm} · ${sc} · ${t.players.length} players`;
}

// ============ server ============
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(S.adminKey ? { "x-admin-key": S.adminKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

async function loadAll() {
  try {
    const list = await api("GET", "/api/tournaments");
    S.tournaments = list;
    S.serverOk = true;
    LS.set("pm.cache", list);
  } catch {
    S.serverOk = false;
  }
  // local edits that haven't reached the server win over the server copy
  for (const t of Object.values(S.pending)) upsertLocal(t);
  S.loaded = true;
  flushPending();
}

async function loadLegacy() {
  try { S.legacy = (await (await fetch("legacy.json", { cache: "no-cache" })).json()).players || []; } catch { S.legacy = []; }
}

function upsertLocal(t) {
  const i = S.tournaments.findIndex((x) => x.id === t.id);
  if (i >= 0) S.tournaments[i] = t; else S.tournaments.unshift(t);
}

function saveT(t) {
  t.localUpdatedAt = Date.now();
  upsertLocal(t);
  S.pending[t.id] = t;
  LS.set("pm.pending", S.pending);
  LS.set("pm.cache", S.tournaments);
  render();
  clearTimeout(saveT.timer);
  saveT.timer = setTimeout(flushPending, 400);
}

let flushing = false;
async function flushPending() {
  if (flushing || !isAdmin()) return;
  flushing = true;
  try {
    for (const [id, t] of Object.entries(S.pending)) {
      try {
        await api("PUT", `/api/tournaments/${id}`, t);
        if (S.pending[id] === t) delete S.pending[id];
        S.serverOk = true;
      } catch (e) {
        S.serverOk = false;
        if (e.status === 401) toast("Organiser key rejected — log in again");
        break;
      }
    }
    LS.set("pm.pending", S.pending);
  } finally {
    flushing = false;
    updateSyncBadge();
  }
}
setInterval(() => { if (Object.keys(S.pending).length) flushPending(); }, 15000);
window.addEventListener("online", flushPending);

function syncText(id) {
  if (S.pending[id]) return S.serverOk === false ? `<span class="sync bad">Not saved online yet — will retry</span>` : `<span class="sync muted">Saving…</span>`;
  return `<span class="sync muted">Saved ✓</span>`;
}
function updateSyncBadge() {
  const el = document.querySelector("[data-sync]");
  if (el) el.innerHTML = syncText(el.dataset.sync);
}

// ============ router ============
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [page, id] = h.split("/");
  return { page: page || "home", id };
}
let refreshTimer = null;
function render() {
  const { page, id } = route();
  document.getElementById("organiser-btn").classList.toggle("on", isAdmin());
  document.getElementById("organiser-btn").innerHTML = isAdmin() ? "Organiser<br>logged in ✓" : "Organiser<br>login";
  clearInterval(refreshTimer);
  if (page === "new") return renderSetup();
  if (page === "t") return renderTournament(id);
  if (page === "stats") return renderStats();
  return renderHome();
}
window.addEventListener("hashchange", () => { S.swapSel = null; render(); window.scrollTo(0, 0); });

// ============ home ============
function renderHome() {
  const live = S.tournaments.filter((t) => t.status === "live");
  const done = S.tournaments.filter((t) => t.status === "finished");
  $app.innerHTML = `
    ${S.serverOk === false ? `<p class="error">Can't reach the server — showing the last saved copy.</p>` : ""}
    ${isAdmin() ? `<a class="btn primary big" href="#/new" style="display:block;text-align:center;text-decoration:none">+ New tournament</a>` : ""}
    ${live.length ? `<h2>Live tournaments</h2>` + live.map(cardFor).join("") : ""}
    <h2>Previous results</h2>
    ${done.length ? done.map(cardFor).join("") : `<p class="muted">No tournaments yet.${isAdmin() ? "" : " The organiser starts them from this page."}</p>`}`;
  if (live.length) refreshTimer = setInterval(async () => { if (!Object.keys(S.pending).length) { await loadAll(); if (route().page === "home") renderHome(); } }, 20000);
}

function cardFor(t) {
  const table = t.rounds.some((r) => r.matches.some(matchDone)) ? standings(t) : [];
  const played = t.rounds.filter(roundDone).length;
  const lead = table[0];
  const winners = t.status === "finished" ? winnersOf(t) : [];
  return `<a class="card link ${t.status === "live" ? "live" : ""}" href="#/t/${t.id}">
    <div class="spread"><strong>${esc(t.name)}</strong>
      <span class="badge ${t.status === "live" ? "live" : "done"}">${t.status === "live" ? `Round ${Math.min(played + 1, t.totalRounds)}/${t.totalRounds}` : "Final"}</span></div>
    <div class="small muted">${fmtDate(t.date)} · ${describe(t)}</div>
    ${winners.length ? `<div style="margin-top:6px">🏆 <strong>${winners.map(esc).join(" &amp; ")}</strong> <span class="muted small">${lead.pf} pts</span></div>`
      : lead && lead.mat ? `<div style="margin-top:6px" class="small">Leading: <strong>${esc(lead.name)}</strong> (${lead.pf})</div>` : ""}
  </a>`;
}

// ============ setup ============
function newDraft() {
  const last = S.tournaments[0];
  return {
    name: last?.name || "Weekly Padel",
    date: today(),
    format: last?.format || "americano",
    teams: last?.teams || "individual",
    unit: last?.scoring?.unit || "points",
    target: last?.scoring?.target || 24,
    fixedTotal: last?.scoring?.fixedTotal ?? true,
    players: [],
    rounds: null, // null = use recommended
  };
}

function knownPlayers() {
  const stats = careerStats(S.tournaments, S.legacy);
  return stats.sort((a, b) => b.trn - a.trn || a.name.localeCompare(b.name)).map((r) => r.name);
}

function renderSetup() {
  if (!isAdmin()) { $app.innerHTML = `<p>Only the organiser can start tournaments. Tap <strong>Organiser</strong> above.</p>`; return; }
  const d = (S.draft ||= newDraft());
  const n = d.players.length;
  const err = validateSetup({ players: d.players, teams: d.teams });
  const rec = n >= MIN_PLAYERS && !err ? recommendedRounds(n, d.teams) : null;
  const rounds = d.rounds ?? rec;
  const chosen = new Set(d.players.map((p) => p.toLowerCase()));
  const pool = knownPlayers().filter((p) => !chosen.has(p.toLowerCase()));
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-act="draft" data-k="${key}" data-v="${v}" class="${d[key] === v ? "on" : ""}">${l}</button>`).join("")}</div>`;

  let slotsHtml = "";
  d.players.forEach((p, i) => {
    if (d.teams === "fixed" && i % 2 === 0) slotsHtml += `<div class="team-label">Pair ${i / 2 + 1}</div>`;
    slotsHtml += `<div class="slot ${S.swapSel === i ? "sel" : ""}" data-act="slot" data-i="${i}">
      <span class="num">${i + 1}</span><span class="name">${esc(p)}</span>
      <button class="x" data-act="remove" data-i="${i}" aria-label="Remove">×</button></div>`;
  });

  let preview = "";
  if (!err && rounds) {
    const t = draftToTournament(d, rounds);
    const r1 = t.rounds[0];
    preview = `<div class="card"><h3>Round 1</h3>${r1.matches.map((m) => `<div class="small">Court ${m.court}: <strong>${names(t, m.a)}</strong> v <strong>${names(t, m.b)}</strong></div>`).join("")}
      ${sittingOut(t, r1).length ? `<div class="small muted">Sitting out: ${sittingOut(t, r1).map((s) => esc(t.players[s])).join(", ")}</div>` : ""}
      ${d.format === "mexicano" ? `<div class="small muted" style="margin-top:6px">Later rounds are drawn from the standings: on each court, 1st &amp; 4th play 2nd &amp; 3rd.</div>` : ""}</div>`;
  }

  const stops = !err ? fairStops(n, d.teams, 21).slice(0, 6) : [];
  const cyc = !err ? cycleInfo(n, d.teams).length : null;

  $app.innerHTML = `
    <h1>New tournament</h1>
    <label class="field"><span>Name</span><input type="text" data-bind="name" value="${esc(d.name)}" /></label>
    <label class="field"><span>Date</span><input type="date" data-bind="date" value="${esc(d.date)}" /></label>
    <label class="field"><span>Format</span>${seg("format", [["americano", "Americano"], ["mexicano", "Mexicano"]])}</label>
    <label class="field"><span>Play as</span>${seg("teams", [["individual", "Individual (rotate partners)"], ["fixed", "Fixed pairs"]])}</label>
    <label class="field"><span>Scoring</span>${seg("unit", [["points", "Points"], ["games", "Games"]])}</label>
    <div class="row">
      <label class="field" style="margin:0"><span>${d.unit === "points" ? "Points per match" : "Games per match"}</span>
        <input type="number" min="1" max="99" inputmode="numeric" data-bind="target" value="${d.target}" /></label>
      <label class="row small" style="margin-top:18px"><input type="checkbox" data-bind="fixedTotal" ${d.fixedTotal ? "checked" : ""}/>
        Scores always add up to ${d.target} (enter one, the other fills in)</label>
    </div>

    <h2>Players <span class="muted small">${n}/${MAX_PLAYERS}</span></h2>
    <div class="row" style="flex-wrap:nowrap">
      <input type="text" id="new-player" placeholder="Add a name…" autocomplete="off" enterkeyhint="done" />
      <button class="btn" data-act="add-typed">Add</button>
    </div>
    ${pool.length ? `<div class="chips" style="margin-top:8px">${pool.map((p) => `<button class="chip" data-act="add" data-name="${esc(p)}">+ ${esc(p)}</button>`).join("")}</div>` : ""}

    ${n ? `<div class="spread" style="margin-top:16px"><h3 style="margin:0">Slots</h3>
      <button class="btn sm" data-act="randomise" ${n < 2 ? "disabled" : ""}>🔀 Randomise</button></div>
      <p class="small muted" style="margin:4px 0 8px">Tap one player, then another, to swap their slots.${d.teams === "fixed" ? " Slots 1&amp;2 are Pair 1, 3&amp;4 Pair 2, and so on." : ""}</p>
      <div class="slots">${slotsHtml}</div>` : ""}

    ${n >= MIN_PLAYERS ? `<label class="field"><span>Rounds</span>
      <input type="number" min="1" max="40" inputmode="numeric" data-bind="rounds" value="${rounds ?? ""}" /></label>
      ${!err ? `<p class="small muted">${d.format === "americano" ? `Full rotation: <strong>${cyc}</strong> rounds. ` : ""}${stops.length > 1 ? `Sit-outs are exactly even at ${stops.join(", ")} rounds.` : ""}</p>` : ""}` : ""}

    ${preview}
    ${err ? `<p class="error">${esc(err)}</p>` : ""}
    <button class="btn primary big" data-act="start" ${err || !rounds ? "disabled" : ""}>Start tournament</button>`;

  const inp = document.getElementById("new-player");
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") addPlayer(inp.value); });
}

function addPlayer(name) {
  const d = S.draft;
  name = (name || "").trim().replace(/\s+/g, " ");
  if (!name) return;
  if (d.players.length >= MAX_PLAYERS) return toast(`Maximum ${MAX_PLAYERS} players`);
  if (d.players.some((p) => p.toLowerCase() === name.toLowerCase())) return toast("Already added");
  d.players.push(name);
  renderSetup();
  document.getElementById("new-player")?.focus();
}

function draftToTournament(d, rounds) {
  const t = {
    id: uid(), name: d.name.trim() || "Padel", date: d.date || today(),
    format: d.format, teams: d.teams,
    scoring: { unit: d.unit, target: Math.max(1, +d.target || 24), fixedTotal: !!d.fixedTotal },
    players: [...d.players], totalRounds: rounds, status: "live", createdAt: Date.now(), rounds: [],
  };
  t.rounds = buildInitialRounds(t);
  return t;
}

// ============ tournament ============
function renderTournament(id) {
  const t = findT(id);
  if (!t) { $app.innerHTML = S.loaded ? `<p>Tournament not found. <a href="#/">Home</a></p>` : `<p class="muted center">Loading…</p>`; return; }
  const canEdit = isAdmin() && t.status === "live";
  const table = standings(t);
  const winners = t.status === "finished" ? winnersOf(t) : [];
  const last = t.rounds[t.rounds.length - 1];
  const needNext = t.format === "mexicano" && t.status === "live" && roundDone(last) && t.rounds.length < t.totalRounds;
  const allDone = t.rounds.length >= t.totalRounds && t.rounds.every(roundDone);
  const firstOpen = t.rounds.findIndex((r) => !roundDone(r));

  const roundsHtml = t.rounds.map((round, ri) => {
    const sit = sittingOut(t, round);
    return `<div class="round" id="r${ri}">
      <div class="round-head"><h3>Round ${ri + 1}</h3>${roundDone(round) ? `<span class="small muted">✓</span>` : ri === firstOpen ? `<span class="badge live">Now</span>` : ""}</div>
      ${round.matches.map((m, mi) => {
        const done = matchDone(m);
        const aw = done && m.sa > m.sb, bw = done && m.sb > m.sa;
        return `<div class="match"><div class="court">Court ${m.court}</div>
          <div class="side ${aw ? "win" : ""}">${m.a.map((x) => esc(t.players[x])).join("<br>")}</div>
          <div class="score">
            <button data-act="pad" data-r="${ri}" data-m="${mi}" class="${Number.isFinite(m.sa) ? "set" : ""}" ${canEdit ? "" : "disabled"}>${Number.isFinite(m.sa) ? m.sa : "–"}</button>
            <button data-act="pad" data-r="${ri}" data-m="${mi}" data-side="b" class="${Number.isFinite(m.sb) ? "set" : ""}" ${canEdit ? "" : "disabled"}>${Number.isFinite(m.sb) ? m.sb : "–"}</button>
          </div>
          <div class="side b ${bw ? "win" : ""}">${m.b.map((x) => esc(t.players[x])).join("<br>")}</div></div>`;
      }).join("")}
      ${sit.length ? `<div class="sitting">Sitting out: ${sit.map((s) => esc(t.players[s])).join(", ")}</div>` : ""}
    </div>`;
  }).join("");

  const pending = t.format === "mexicano" && t.rounds.length < t.totalRounds
    ? `<p class="small muted">${t.totalRounds - t.rounds.length} more round(s) — drawn from the standings when the current round is finished.</p>` : "";

  const { P, O } = meetings(t);
  const short = t.players.map((p) => esc(p.split(" ")[0].slice(0, 6)));
  const matrix = `<div class="table-wrap"><table class="matrix"><tr><th></th>${short.map((s) => `<th>${s}</th>`).join("")}</tr>
    ${t.players.map((p, i) => `<tr><th class="l">${esc(p)}</th>${t.players.map((_, j) => i === j ? `<td class="self"></td>`
      : `<td class="${P[i][j] > 1 || O[i][j] > 3 ? "hot" : ""}">${P[i][j]}/${O[i][j]}</td>`).join("")}</tr>`).join("")}
    </table></div><p class="small muted">Each cell: times as partners / times as opponents (including rounds not yet played).</p>`;

  $app.innerHTML = `
    <div class="spread"><h1>${esc(t.name)}</h1><span class="badge ${t.status === "live" ? "live" : "done"}">${t.status === "live" ? "Live" : "Final"}</span></div>
    <div class="small muted">${fmtDate(t.date)} · ${describe(t)}</div>
    ${isAdmin() ? `<div data-sync="${t.id}" style="margin-top:4px">${syncText(t.id)}</div>` : ""}
    ${winners.length ? `<div class="card" style="text-align:center;font-size:18px">🏆 <strong>${winners.map(esc).join(" &amp; ")}</strong></div>` : ""}

    <h2>Standings</h2>${standingsTable(table, t)}

    <h2>Matches</h2>
    ${roundsHtml}
    ${needNext && isAdmin() ? `<button class="btn primary big" data-act="next-round" data-id="${t.id}">Draw round ${t.rounds.length + 1}</button>` : ""}
    ${pending}

    <details style="margin-top:18px"><summary>Who played with / against whom</summary>${matrix}</details>

    ${isAdmin() ? `<h2>Organiser</h2><div class="row">
      ${t.status === "live" ? `<button class="btn ${allDone ? "primary" : ""}" data-act="finish" data-id="${t.id}">Finish &amp; save result</button>
        <button class="btn ghost" data-act="add-round" data-id="${t.id}">+ Add a round</button>`
        : `<button class="btn ghost" data-act="reopen" data-id="${t.id}">Reopen to edit scores</button>`}
      <button class="btn danger" data-act="delete" data-id="${t.id}">Delete</button></div>` : ""}
    <p class="small muted" style="margin-top:20px">Share this page: <a href="${location.href}">${esc(location.href)}</a></p>`;

  if (t.status === "live" && !isAdmin()) {
    refreshTimer = setInterval(async () => { await loadAll(); if (route().id === id) renderTournament(id); }, 15000);
  }
}

function standingsTable(table, t) {
  const showSat = table.some((r) => r.sat);
  return `<div class="table-wrap"><table>
    <tr><th class="l">#</th><th class="l">${t.teams === "fixed" ? "Pair" : "Player"}</th><th>Pts</th><th>M</th><th>W</th><th>D</th><th>L</th><th>Diff</th>${showSat ? "<th>Sat</th>" : ""}</tr>
    ${table.map((r) => `<tr class="${r.pos === 1 && r.mat ? "top1" : ""}"><td class="l">${r.pos}</td><td class="name l">${esc(r.name)}</td>
      <td><strong>${r.pf}</strong></td><td>${r.mat}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.pf - r.pa > 0 ? "+" : ""}${r.pf - r.pa}</td>${showSat ? `<td>${r.sat}</td>` : ""}</tr>`).join("")}
  </table></div>`;
}

// ============ score pad ============
let pad = null;
function openPad(t, ri, mi, side) {
  const m = t.rounds[ri].matches[mi];
  pad = { id: t.id, ri, mi, side: side || "a", sa: m.sa, sb: m.sb };
  drawPad();
}
function drawPad() {
  if (!pad) { $modal.innerHTML = ""; return; }
  const t = findT(pad.id);
  const m = t.rounds[pad.ri].matches[pad.mi];
  const { target, fixedTotal } = t.scoring;
  const max = fixedTotal ? target : Math.max(target, 7);
  const cur = pad.side === "a" ? pad.sa : pad.sb;
  const nums = max <= 60 ? Array.from({ length: max + 1 }, (_, i) => i) : [];
  $modal.innerHTML = `<div class="modal-bg" data-act="pad-close-bg"><div class="modal">
    <div class="spread"><strong>Round ${pad.ri + 1} · Court ${m.court}</strong><button class="btn sm ghost" data-act="pad-close">Cancel</button></div>
    <div class="pad-sides" style="margin-top:10px">
      <div class="pad-side ${pad.side === "a" ? "active" : ""}" data-act="pad-side" data-side="a"><div class="who">${names(t, m.a)}</div><div class="val">${pad.sa ?? "–"}</div></div>
      <div class="pad-side ${pad.side === "b" ? "active" : ""}" data-act="pad-side" data-side="b"><div class="who">${names(t, m.b)}</div><div class="val">${pad.sb ?? "–"}</div></div>
    </div>
    <p class="small muted" style="margin:8px 0 0">${fixedTotal ? `Tap a score for the highlighted side — the other side becomes ${target} minus it.` : `Tap a side, then its score.`}</p>
    ${nums.length ? `<div class="pad-grid">${nums.map((v) => `<button data-act="pad-num" data-v="${v}" class="${cur === v ? "on" : ""}">${v}</button>`).join("")}</div>`
      : `<input type="number" inputmode="numeric" data-act="pad-input" value="${cur ?? ""}" style="margin:12px 0"/>`}
    <div class="row"><button class="btn ghost" data-act="pad-clear">Clear</button>
      <button class="btn primary" style="flex:1" data-act="pad-save" ${Number.isFinite(pad.sa) && Number.isFinite(pad.sb) ? "" : "disabled"}>Save score</button></div>
  </div></div>`;
}
function padSet(v) {
  const t = findT(pad.id);
  const { target, fixedTotal } = t.scoring;
  if (pad.side === "a") { pad.sa = v; if (fixedTotal) pad.sb = Math.max(0, target - v); else if (!Number.isFinite(pad.sb)) pad.side = "b"; }
  else { pad.sb = v; if (fixedTotal) pad.sa = Math.max(0, target - v); else if (!Number.isFinite(pad.sa)) pad.side = "a"; }
  drawPad();
}
function padSave() {
  const t = findT(pad.id);
  const m = t.rounds[pad.ri].matches[pad.mi];
  m.sa = pad.sa; m.sb = pad.sb;
  const ri = pad.ri;
  pad = null; drawPad();
  // Mexicano: when the last round is complete, draw the next one automatically
  if (t.format === "mexicano" && ri === t.rounds.length - 1 && roundDone(t.rounds[ri]) && t.rounds.length < t.totalRounds) {
    t.rounds.push(nextMexicanoRound(t));
    toast(`Round ${t.rounds.length} drawn from the standings`);
  }
  saveT(t);
  const nextOpen = t.rounds.findIndex((r) => !roundDone(r));
  if (nextOpen > ri) document.getElementById("r" + nextOpen)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ============ stats ============
function renderStats() {
  const finished = S.tournaments.filter((t) => t.status === "finished");
  const rows = careerStats(finished, S.includeLegacy ? S.legacy : []).map((r) => ({
    ...r, diff: r.pf - r.pa,
    winPct: r.mat ? Math.round((100 * (r.w + r.d / 2)) / r.mat) : 0,
    ptsPct: r.pf + r.pa ? Math.round((1000 * r.pf) / (r.pf + r.pa)) / 10 : 0,
    avg: r.mat ? +(r.pf / r.mat).toFixed(1) : 0,
  }));
  const { key, dir } = S.statsSort;
  rows.sort((a, b) => (typeof a[key] === "string" ? a[key].localeCompare(b[key]) * -dir : (a[key] - b[key]) * dir) || b.trnWin - a.trnWin || b.winPct - a.winPct);
  const cols = [["name", "Name"], ["trn", "Trn"], ["trnWin", "Trn win"], ["mat", "Mat"], ["winPct", "Match %"], ["ptsPct", "Pts %"], ["w", "W"], ["d", "D"], ["l", "L"], ["pf", "Pts+"], ["pa", "Pts−"], ["diff", "Diff"], ["avg", "Avg"]];
  $app.innerHTML = `
    <h1>All-time leaderboard</h1>
    <p class="small muted">Tap a column to sort. Match % = matches won (a draw counts as half). Pts % = share of all points played that you won. Avg = points per match.</p>
    <div class="table-wrap"><table class="stats">
      <tr>${cols.map(([k, l]) => `<th class="${k === "name" ? "l " : ""}${k === key ? "sorted" : ""}" data-act="sort" data-k="${k}">${l}${k === key ? (dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr>
      ${rows.map((r) => `<tr><td class="name l">${esc(r.name)}</td>${cols.slice(1).map(([k]) => `<td>${k === "diff" && r[k] > 0 ? "+" : ""}${k === "ptsPct" ? r[k].toFixed(1) : r[k]}${k === "winPct" || k === "ptsPct" ? "%" : ""}</td>`).join("")}</tr>`).join("")}
    </table></div>
    <label class="row small" style="margin-top:14px"><input type="checkbox" data-act="legacy" ${S.includeLegacy ? "checked" : ""}/> Include totals from the old app</label>
    <h2>Backup</h2>
    <div class="row"><button class="btn" data-act="export-json">Download everything (JSON)</button>
      <button class="btn" data-act="export-csv">Download all matches (CSV)</button></div>`;
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportCsv() {
  const lines = [["date", "tournament", "format", "round", "court", "team_a", "team_b", "score_a", "score_b"].join(",")];
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  for (const t of S.tournaments) t.rounds.forEach((r, ri) => r.matches.forEach((m) => {
    if (!matchDone(m)) return;
    lines.push([t.date, q(t.name), t.format, ri + 1, m.court, q(m.a.map((s) => t.players[s]).join(" & ")), q(m.b.map((s) => t.players[s]).join(" & ")), m.sa, m.sb].join(","));
  }));
  download(`padel-matches-${today()}.csv`, lines.join("\n"), "text/csv");
}

// ============ organiser login ============
function openLogin() {
  $modal.innerHTML = `<div class="modal-bg" data-act="pad-close-bg"><div class="modal">
    <h3>${isAdmin() ? "Organiser" : "Organiser login"}</h3>
    ${isAdmin() ? `<p class="small">You're logged in on this device and can create and score tournaments.</p>
      <div class="row"><button class="btn danger" data-act="logout">Log out</button><button class="btn ghost" data-act="pad-close">Close</button></div>`
      : `<p class="small muted">Enter the organiser key (the ADMIN_KEY you set in Netlify). Everyone else can view without it.</p>
      <input type="password" id="key-input" autocomplete="current-password" placeholder="Organiser key" />
      <p class="error" id="key-err"></p>
      <div class="row"><button class="btn ghost" data-act="pad-close">Cancel</button><button class="btn primary" style="flex:1" data-act="login">Log in</button></div>`}
  </div></div>`;
  document.getElementById("key-input")?.focus();
}
async function login() {
  const key = document.getElementById("key-input").value.trim();
  if (!key) return;
  const prev = S.adminKey;
  S.adminKey = key;
  try {
    await api("GET", "/api/auth");
    LS.set("pm.adminKey", key);
    $modal.innerHTML = "";
    toast("Logged in as organiser");
    flushPending();
    render();
  } catch (e) {
    S.adminKey = prev;
    document.getElementById("key-err").textContent = e.status === 401 ? "That key isn't right." : "Couldn't reach the server — check your connection.";
  }
}

// ============ events ============
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  const d = S.draft;
  switch (act) {
    case "organiser": return openLogin();
    case "login": return login();
    case "logout": S.adminKey = ""; LS.set("pm.adminKey", ""); $modal.innerHTML = ""; return render();
    case "draft": d[el.dataset.k] = el.dataset.v; if (el.dataset.k === "teams" || el.dataset.k === "format") d.rounds = null; S.swapSel = null; return renderSetup();
    case "add": return addPlayer(el.dataset.name);
    case "add-typed": return addPlayer(document.getElementById("new-player").value);
    case "remove": e.stopPropagation(); d.players.splice(+el.dataset.i, 1); S.swapSel = null; d.rounds = null; return renderSetup();
    case "slot": {
      const i = +el.dataset.i;
      if (S.swapSel == null) S.swapSel = i;
      else { if (S.swapSel !== i) [d.players[S.swapSel], d.players[i]] = [d.players[i], d.players[S.swapSel]]; S.swapSel = null; }
      return renderSetup();
    }
    case "randomise": d.players = shuffle(d.players); S.swapSel = null; return renderSetup();
    case "start": {
      const rounds = d.rounds ?? recommendedRounds(d.players.length, d.teams);
      const t = draftToTournament(d, rounds);
      S.draft = null;
      saveT(t);
      location.hash = `#/t/${t.id}`;
      return;
    }
    case "pad": { const t = findT(route().id); return openPad(t, +el.dataset.r, +el.dataset.m, el.dataset.side || "a"); }
    case "pad-side": pad.side = el.dataset.side; return drawPad();
    case "pad-num": return padSet(+el.dataset.v);
    case "pad-clear": pad.sa = null; pad.sb = null; pad.side = "a"; return drawPad();
    case "pad-save": return padSave();
    case "pad-close": pad = null; $modal.innerHTML = ""; return;
    case "pad-close-bg": if (e.target === el) { pad = null; $modal.innerHTML = ""; } return;
    case "next-round": { const t = findT(el.dataset.id); t.rounds.push(nextMexicanoRound(t)); return saveT(t); }
    case "add-round": {
      const t = findT(el.dataset.id);
      t.totalRounds++;
      if (t.format === "americano") t.rounds = buildInitialRounds(t).map((r, i) => t.rounds[i] || r);
      else if (roundDone(t.rounds[t.rounds.length - 1])) t.rounds.push(nextMexicanoRound(t));
      toast(`Round ${t.totalRounds} added`);
      return saveT(t);
    }
    case "finish": {
      const t = findT(el.dataset.id);
      const open = t.rounds.flatMap((r) => r.matches).filter((m) => !matchDone(m)).length;
      if (open && !confirm(`${open} match(es) have no score. Finish anyway? Unscored matches won't count.`)) return;
      t.status = "finished"; t.finishedAt = Date.now();
      if (open) t.rounds = t.rounds.map((r) => ({ matches: r.matches.filter(matchDone) })).filter((r) => r.matches.length);
      t.totalRounds = t.rounds.length;
      toast("Result saved 🏆");
      return saveT(t);
    }
    case "reopen": { const t = findT(el.dataset.id); t.status = "live"; return saveT(t); }
    case "delete": {
      const t = findT(el.dataset.id);
      if (!confirm(`Delete "${t.name}" (${fmtDate(t.date)})? This can't be undone.`)) return;
      try {
        await api("DELETE", `/api/tournaments/${t.id}`);
      } catch (err) { if (err.status !== 404) return toast("Couldn't delete — are you online?"); }
      delete S.pending[t.id]; LS.set("pm.pending", S.pending);
      S.tournaments = S.tournaments.filter((x) => x.id !== t.id); LS.set("pm.cache", S.tournaments);
      location.hash = "#/";
      return;
    }
    case "sort": {
      const k = el.dataset.k;
      S.statsSort = { key: k, dir: S.statsSort.key === k ? -S.statsSort.dir : (k === "name" ? 1 : -1) };
      LS.set("pm.statsSort", S.statsSort);
      return renderStats();
    }
    case "legacy": S.includeLegacy = el.checked; LS.set("pm.includeLegacy2", S.includeLegacy); return renderStats();
    case "export-json": return download(`padel-backup-${today()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), tournaments: S.tournaments, legacy: S.legacy }, null, 1), "application/json");
    case "export-csv": return exportCsv();
  }
});

document.addEventListener("input", (e) => {
  const el = e.target;
  const k = el.dataset.bind;
  if (!k || !S.draft) return;
  if (k === "fixedTotal") S.draft.fixedTotal = el.checked;
  else if (k === "target") S.draft.target = parseInt(el.value, 10) || "";
  else if (k === "rounds") S.draft.rounds = parseInt(el.value, 10) || null;
  else S.draft[k] = el.value;
});
// re-render setup after number/checkbox edits settle (keeps typing smooth)
document.addEventListener("change", (e) => {
  if (e.target.dataset.act === "pad-input") { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) padSet(v); return; }
  if (e.target.dataset.bind && route().page === "new") renderSetup(); });

// ============ start ============
(async () => {
  render();
  await Promise.all([loadLegacy(), loadAll()]);
  render();
  if ("serviceWorker" in navigator && location.hostname !== "localhost") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
