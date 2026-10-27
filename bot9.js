// MirroTic 9×9 (experimental) — pure bot + rules logic, no DOM.
//
// Board: 9×9 = nine 3×3 quadrants, indexed 0..8 row-major:
//   0 1 2
//   3 4 5
//   6 7 8
// Each round's hidden configuration: one quadrant is UNPAIRED (moves there are not mirrored),
// the other eight form 4 random pairs, and each pair gets an independent random mirror rule
// (x-axis, y-axis or both). 9 × 105 × 81 = 76,545 possible configurations.
// Rounds last 30 moves. Scoring is unchanged: a maximal line of n ≥ 3 scores n × (n − 2).
//
// Information model: bots see the board and the round's (cell, copy) history. Their belief is the
// set of configurations consistent with that history; the engine alone knows the true one.
(function (root) {
  const N = 9, CELLS = 81, MOVES_PER_ROUND = 30;
  const RULES = ['x-axis', 'y-axis', 'both'];
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const quadOf = c => Math.floor(Math.floor(c / N) / 3) * 3 + Math.floor((c % N) / 3);
  const qOrigin = q => [Math.floor(q / 3) * 3, (q % 3) * 3];

  // ---------- Configuration space ----------
  function matchings(items) {            // all perfect matchings of an even-length list
    if (!items.length) return [[]];
    const [a, ...rest] = items, out = [];
    for (let i = 0; i < rest.length; i++) {
      const b = rest[i], remaining = rest.filter((_, j) => j !== i);
      for (const m of matchings(remaining)) out.push([[a, b], ...m]);
    }
    return out;
  }
  let MAPS = null, META = null, COUNT = 0;
  function buildAll() {
    if (MAPS) return;
    const list = [];
    for (let u = 0; u < 9; u++) {
      const others = [...Array(9).keys()].filter(q => q !== u);
      for (const m of matchings(others)) {
        for (let r = 0; r < 81; r++) {
          const rules = [Math.floor(r / 27) % 3, Math.floor(r / 9) % 3, Math.floor(r / 3) % 3, r % 3];
          list.push({ u, pairs: m, rules });
        }
      }
    }
    COUNT = list.length;
    MAPS = new Uint8Array(COUNT * CELLS);
    META = list;
    list.forEach((cfg, k) => {
      const base = k * CELLS;
      for (let c = 0; c < CELLS; c++) MAPS[base + c] = c;           // unpaired cells map to themselves
      cfg.pairs.forEach(([a, b], i) => {
        const rule = RULES[cfg.rules[i]];
        const [ar, ac] = qOrigin(a), [br, bc] = qOrigin(b);
        for (let lr = 0; lr < 3; lr++) for (let lc = 0; lc < 3; lc++) {
          const mr = rule === 'x-axis' ? lr : 2 - lr;
          const mc = rule === 'y-axis' ? lc : 2 - lc;
          const from = (ar + lr) * N + (ac + lc), to = (br + mr) * N + (bc + mc);
          MAPS[base + from] = to;
          MAPS[base + to] = from;
        }
      });
    });
  }
  const mapOf = k => { buildAll(); return MAPS.subarray(k * CELLS, (k + 1) * CELLS); };
  const randomConfig = () => { buildAll(); return Math.floor(Math.random() * COUNT); };
  function describeConfig(k) {
    buildAll();
    const m = META[k];
    return `unpaired Q${m.u + 1}; ` + m.pairs.map(([a, b], i) => `Q${a + 1}–Q${b + 1} ${RULES[m.rules[i]]}`).join(', ');
  }

  // ---------- Rules ----------
  function applyMove(b, c, player, map) { b[c] = player; b[map[c]] = player; }

  function findRuns(b) {
    const runs = [];
    for (const [dr, dc] of DIRS) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const p = b[r * N + c];
        if (!p) continue;
        const pr = r - dr, pc = c - dc;
        if (pr >= 0 && pr < N && pc >= 0 && pc < N && b[pr * N + pc] === p) continue;
        let n = 1, rr = r + dr, cc = c + dc;
        while (rr >= 0 && rr < N && cc >= 0 && cc < N && b[rr * N + cc] === p) { n++; rr += dr; cc += dc; }
        if (n >= 3) runs.push({ p, n, r0: r, c0: c, r1: r + dr * (n - 1), c1: c + dc * (n - 1), pts: n * (n - 2) });
      }
    }
    return runs;
  }
  function score(b) {
    const s = { X: 0, O: 0 };
    for (const run of findRuns(b)) s[run.p] += run.pts;
    return s;
  }
  const empties = b => b.reduce((a, v, i) => (v ? a : (a.push(i), a)), []);
  const other = p => (p === 'X' ? 'O' : 'X');
  const pickRandom = a => a[Math.floor(Math.random() * a.length)];

  // ---------- Belief ----------
  // Belief = Int32Array of config indices consistent with every observed [cell, copy] pair.
  function beliefFrom(history) {
    buildAll();
    let cur = null;
    for (const [c, copy] of history) {
      const src = cur || null, out = [];
      if (src) { for (const k of src) if (MAPS[k * CELLS + c] === copy) out.push(k); }
      else { for (let k = 0; k < COUNT; k++) if (MAPS[k * CELLS + c] === copy) out.push(k); }
      cur = Int32Array.from(out);
    }
    if (!cur) { cur = new Int32Array(COUNT); for (let k = 0; k < COUNT; k++) cur[k] = k; }
    return cur;
  }
  function sample(belief, n) {
    if (belief.length <= n) return Array.from(belief);
    const picked = new Set();
    while (picked.size < n) picked.add(belief[Math.floor(Math.random() * belief.length)]);
    return [...picked];
  }

  // ---------- Search ----------
  const settings = { depth: 2, samples: 8 };
  const movesUnder = (b, map) => { const o = []; for (let i = 0; i < CELLS; i++) if (!b[i] && i <= map[i]) o.push(i); return o; };
  function negamax(b, map, p, d, left, alpha, beta) {
    const ms = left > 0 ? movesUnder(b, map) : [];
    if (!d || !ms.length) { const s = score(b); return s[p] - s[other(p)]; }
    let v = -Infinity;
    for (const i of ms) {
      const t = b.slice(); applyMove(t, i, p, map);
      v = Math.max(v, -negamax(t, map, other(p), d - 1, left - 1, -beta, -alpha));
      alpha = Math.max(alpha, v);
      if (alpha >= beta) break;
    }
    return v;
  }
  // Public-information move choice: average score difference over sampled consistent configurations.
  // movesLeft counts this move too.
  function chooseMove(b, player, history, movesLeft, depth = settings.depth) {
    const belief = beliefFrom(history);
    const maps = sample(belief, settings.samples).map(mapOf);
    const cands = [];
    for (let c = 0; c < CELLS; c++) {
      if (b[c]) continue;
      const t = maps[0][c];
      if (t < c && maps.every(m => m[c] === t)) continue;      // same move as clicking t
      cands.push(c);
    }
    let best = -Infinity, picks = [];
    for (const c of cands) {
      let v = 0;
      for (const m of maps) {
        const t = b.slice(); applyMove(t, c, player, m);
        v += -negamax(t, m, other(player), depth - 1, movesLeft - 1, -Infinity, Infinity);
      }
      v /= maps.length;
      if (v > best + 1e-9) { best = v; picks = [c]; } else if (Math.abs(v - best) <= 1e-9) picks.push(c);
    }
    return pickRandom(picks);
  }
  function configure(opts) { Object.assign(settings, opts); }

  root.MirroBot9 = {
    N, CELLS, MOVES_PER_ROUND, quadOf, randomConfig, mapOf, describeConfig, get configCount() { buildAll(); return COUNT; },
    applyMove, findRuns, score, empties, beliefFrom, chooseMove, configure,
  };
})(typeof window !== 'undefined' ? window : globalThis);
