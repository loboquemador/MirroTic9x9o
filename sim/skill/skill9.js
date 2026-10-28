// Skill-ceiling benchmark bots for MirroTic 9×9. The game (script9x9.js) loads this file for its AI (beamsearch_d3w3_evo).
// Built on sim/fast9.js: same search (negamax + alpha-beta over 8 sampled belief configurations,
// averaged at the root). negamax_d3 is identical in value to the game bot at depth 3.
// Variants:
//   negamax_d1          depth 1: greedy, best expected immediate gain over the sampled configurations
//   negamax_d2          depth 2: me → opponent; same depth as the in-game bot (AI_DEPTH = 2)
//   negamax_d3          depth 3, leaf = score difference
//   negamax_d4          depth 4, otherwise identical to negamax_d3
//   negamax_d3_threat   depth 3, leaf = score difference + LAMBDA × (my open scoring threats − opponent's)
//   negamax_d4_threat   depth 4 + negamax_d3_threat's evaluation (round 2)
//   negamax_d3_line     depth 3, leaf = score difference + MU × line potential (achievable segments; round 2)
//   beamsearch_d3w3     depth 3, width 3: at every ply (root included) only the 3 moves with the best
//                       immediate gain are searched; leaf = score difference
//   beamsearch_d3w5     same, width 5
//   beamsearch_d3w3_softmax100  beamsearch_d3w3, but the root move is drawn by softmax over the evaluated
//                           candidates' search values, T = 40 points (opts.temp overrides)
//   beamsearch_d3w3_softmax65 / _softmax35  each move: 65% / 35% as softmax100, otherwise a uniformly random empty
//                           cell (opts.eps = random share overrides)
//   beamsearch_d3w3_threat  width 3 with the threat evaluation; moves are ranked by gain + threat change
//   beamsearch_d3w3_combo   width 3, V = scoreDiff + a·threatDiff + b·lineDiff; chooseMove(..., {a, b})
//   beamsearch_d3w3_evo     beamsearch_d3w3_combo fixed at the evolved weights a = 0.366, b = 1.162
//   beamsearch_d2w3_evo     depth 2, width 3, same evolved weights
//   beamsearch_d4w3_evo     depth 4, width 3, same evolved weights (not re-tuned for depth 4)
//   beamsearch_d5w3_evo … beamsearch_d8w3_evo / beamsearch_d4w5_evo   depth and width scaling, same evolved weights
//   random_d0               uniform random empty cell, no lookahead or evaluation (floor reference)
//   beamsearch_d4w5_evoh    beamsearch_d4w5_evo with horizon-aware leaf values and exact terminal scoring (negamaxH)
//   beamsearch_d4w5_evohf065 beamsearch_d4w5_evoh + λ·forcedScoreDiff at the leaves (λ = 0.65; opts.f overrides)
//   beamsearch_d4w2div4_evoh depth 4, EvoH; at every beam ply evo top 2 + defensive, strategic, defensive, strategic
//   beamsearch_d4w3div2_evoh depth 4, beamsearch_d3w3div2_evo's diversified beam with beamsearch_d4w5_evoh's
//                           horizon-aware leaf and terminal scoring
//   ismcts_sim800_evoh_probing  the same with 800 iterations
//   ismcts_sim200_evoh_probing  information-set MCTS, 200 iterations, one sampled world per iteration, EvoH leaf
//                           values, progressive widening by Evo rank, entropy bonus at the root (see chooseMoveIS);
//                           tuning via VARIANTS[…].is or chooseMove(…, { is: { sims, c, beta, … } })
//   beamsearch_d3w3div2_evo depth 3, evo weights; at every beam ply the top 3 + a defensive and a strategic
//                           alternative (see diversify())
//   beamsearch_d3w3_nnue_pure    beamsearch_d3w3_evo's search with the trained NNUE ranking moves and valuing leaves
//   beamsearch_d3w3_nnue_hybrid  same search, exact current score + calibrated NNUE contribution
//                                (both need MirroNNUE9 + MirroNNUE9_WEIGHTS globals; see the NNUE section below)
// Legacy short ids (D3, D4, D3P, D4P, D3L) still work; the raw result files use them. beamsearch_w3d3_evo
// is an alias of beamsearch_d3w3_evo (early name).
// negamax_d3_info (D3I) was removed after round 1; its results remain in sim/skill/res for the record.
// Bots only receive (board, player, observed history, movesLeft) — never the hidden configuration.
// Usage: const K = new Function('B', src)(MirroBot9); K.chooseMove('negamax_d3', board, player, history, movesLeft)
const N = 9, CELLS = 81, SAMPLES = 8;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const f = n => (n >= 3 ? n * (n - 2) : 0);
const FWD = new Int8Array(CELLS * 32), BCK = new Int8Array(CELLS * 32), FL = new Int8Array(CELLS * 4), BL = new Int8Array(CELLS * 4);
for (let c = 0; c < CELLS; c++) {
  const r = Math.floor(c / N), col = c % N;
  DIRS.forEach(([dr, dc], d) => {
    const o = c * 4 + d;
    for (let k = 1; k < N; k++) { const rr = r + dr * k, cc = col + dc * k; if (rr < 0 || rr >= N || cc < 0 || cc >= N) break; FWD[o * 8 + FL[o]++] = rr * N + cc; }
    for (let k = 1; k < N; k++) { const rr = r - dr * k, cc = col - dc * k; if (rr < 0 || rr >= N || cc < 0 || cc >= N) break; BCK[o * 8 + BL[o]++] = rr * N + cc; }
  });
}
const F_TAB = Int16Array.from({ length: 20 }, (_, n) => f(n));
const comp = (a, b) => (a + b >= 2 ? F_TAB[a + b + 1] - F_TAB[a] - F_TAB[b] : 0);
const P = { LAMBDA: 0.25, MU: 1, A: 0.25, B: 1 };   // LAMBDA/MU calibrated on pilot configs (sim/skill/pilot.json); A/B: combo defaults

function gain(b, c, v) {
  let g = 0;
  for (let d = 0; d < 4; d++) {
    const o = c * 4 + d, base = o * 8;
    let R = 0; const fl = FL[o]; while (R < fl && b[FWD[base + R]] === v) R++;
    let L = 0; const bl = BL[o]; while (L < bl && b[BCK[base + L]] === v) L++;
    if (L + R >= 2) g += F_TAB[L + R + 1] - F_TAB[L] - F_TAB[R];
  }
  return g;
}
function make(b, map, c, v) {
  let g = gain(b, c, v); b[c] = v;
  const m = map[c];
  if (m !== c) { g += gain(b, m, v); b[m] = v; }
  return g;
}
function unmake(b, map, c) { b[c] = 0; b[map[c]] = 0; }

// Positional placement. T_p = Σ over empty cells of gain(cell, p) = points p could score there next.
// Placing v at c: c leaves both sums; only the run endpoints on c's lines change for v; opponent's
// line scans stop at c before and after, so T_u only loses c. Returns gain + LAMBDA·(ΔT_v − ΔT_u).
function placeP(b, c, v) {
  const gv = gain(b, c, v), gu = gain(b, c, 3 - v);
  let dv = -gv;
  for (let d = 0; d < 4; d++) {
    const o = c * 4 + d, base = o * 8, fl = FL[o], bl = BL[o];
    let R = 0; while (R < fl && b[FWD[base + R]] === v) R++;
    let L = 0; while (L < bl && b[BCK[base + L]] === v) L++;
    if (R < fl) {
      const e = FWD[base + R];
      if (!b[e]) { const oe = e * 4 + d, be = oe * 8, fe = FL[oe]; let k = 0; while (k < fe && b[FWD[be + k]] === v) k++; dv += comp(R + 1 + L, k) - comp(R, k); }
    }
    if (L < bl) {
      const e = BCK[base + L];
      if (!b[e]) { const oe = e * 4 + d, be = oe * 8, le = BL[oe]; let k = 0; while (k < le && b[BCK[be + k]] === v) k++; dv += comp(L + 1 + R, k) - comp(L, k); }
    }
  }
  b[c] = v;
  return gv + P.LAMBDA * (dv + gu);
}
function makeP(b, map, c, v) {
  let s = placeP(b, c, v);
  const m = map[c];
  if (m !== c) s += placeP(b, m, v);
  return s;
}

// Line-potential evaluation (negamax_d3_line). For every row/column/diagonal of length ≥ 3 and each player,
// split the line at opponent stones into segments; a segment of length S ≥ 3 holding k own stones
// is an achievable line worth POT(S,k) = f(S)·(k/S)². LV(line) = Pot_X − Pot_O. Counterplay is
// captured symmetrically: cutting an opponent segment shrinks its achievable length.
const LINES = [], CELL_LINES = Array.from({ length: CELLS }, () => []);
DIRS.forEach(([dr, dc]) => {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const pr = r - dr, pc = c - dc;
    if (pr >= 0 && pr < N && pc >= 0 && pc < N) continue;             // not a line start
    const cells = [];
    for (let rr = r, cc = c; rr >= 0 && rr < N && cc >= 0 && cc < N; rr += dr, cc += dc) cells.push(rr * N + cc);
    if (cells.length < 3) continue;
    const id = LINES.length; LINES.push(Int8Array.from(cells));
    for (const x of cells) CELL_LINES[x].push(id);
  }
});
const POT = new Float64Array(100);
for (let S = 3; S <= 9; S++) for (let k = 0; k <= S; k++) POT[S * 10 + k] = f(S) * (k / S) ** 2;
function lineVal(b, L) {
  let tot = 0;
  for (let p = 1; p <= 2; p++) {
    const q = 3 - p, sg = p === 1 ? 1 : -1;
    let S = 0, k = 0;
    for (let j = 0; j < L.length; j++) {
      const x = b[L[j]];
      if (x === q) { if (S >= 3) tot += sg * POT[S * 10 + k]; S = 0; k = 0; }
      else { S++; if (x === p) k++; }
    }
    if (S >= 3) tot += sg * POT[S * 10 + k];
  }
  return tot;
}
function placeL(b, c, v) {
  const g = gain(b, c, v), ls = CELL_LINES[c];
  let d = 0;
  for (let j = 0; j < ls.length; j++) d -= lineVal(b, LINES[ls[j]]);
  b[c] = v;
  for (let j = 0; j < ls.length; j++) d += lineVal(b, LINES[ls[j]]);
  return g + P.MU * (v === 1 ? d : -d);
}
function makeL(b, map, c, v) {
  let s = placeL(b, c, v);
  const m = map[c];
  if (m !== c) s += placeL(b, m, v);
  return s;
}

// Combined evaluation (evolution experiment): gain + A · threat change + Bw · line-potential change,
// using the same threat and line terms as placeP / placeL (A = LAMBDA, Bw = MU there).
function threatDelta(b, c, v) {                       // (ΔT_v − ΔT_u) for placing v at c; b unchanged
  const gv = gain(b, c, v), gu = gain(b, c, 3 - v);
  let dv = -gv;
  for (let d = 0; d < 4; d++) {
    const o = c * 4 + d, base = o * 8, fl = FL[o], bl = BL[o];
    let R = 0; while (R < fl && b[FWD[base + R]] === v) R++;
    let L = 0; while (L < bl && b[BCK[base + L]] === v) L++;
    if (R < fl) {
      const e = FWD[base + R];
      if (!b[e]) { const oe = e * 4 + d, be = oe * 8, fe = FL[oe]; let k = 0; while (k < fe && b[FWD[be + k]] === v) k++; dv += comp(R + 1 + L, k) - comp(R, k); }
    }
    if (L < bl) {
      const e = BCK[base + L];
      if (!b[e]) { const oe = e * 4 + d, be = oe * 8, le = BL[oe]; let k = 0; while (k < le && b[BCK[be + k]] === v) k++; dv += comp(L + 1 + R, k) - comp(L, k); }
    }
  }
  return dv + gu;
}
function placeC(b, c, v, A, Bw) {
  let s = gain(b, c, v);
  if (A) s += A * threatDelta(b, c, v);
  if (Bw) {
    const ls = CELL_LINES[c];
    let d = 0;
    for (let j = 0; j < ls.length; j++) d -= lineVal(b, LINES[ls[j]]);
    b[c] = v;
    for (let j = 0; j < ls.length; j++) d += lineVal(b, LINES[ls[j]]);
    s += Bw * (v === 1 ? d : -d);
  } else b[c] = v;
  return s;
}
function makeCombo(A, Bw) {
  return function (b, map, c, v) {
    let s = placeC(b, c, v, A, Bw);
    const m = map[c];
    if (m !== c) s += placeC(b, m, v, A, Bw);
    return s;
  };
}

// pos: positional make function (makeP | makeL) or null for plain score difference.
// beam: if > 0, only the `beam` moves with the best immediate value are expanded at each ply
// (ties broken randomly via a shuffle before the stable sort). 0 = full-width negamax.
// Values are from v's perspective; diff = accumulated value so far.
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
// Diversified beam (beamsearch_d3w3div2_evo). ms: [cell, evo value, block] sorted by evo value, best first.
// Keeps the top W, then adds up to `div` alternatives from the rest:
//   defensive  the move that removes the most opponent points from the board (block = the points the
//              opponent would score on that cell and its mirror, which is exactly how much the opponent's
//              threat sum drops); if no move blocks anything, the next-best evo move
//   strategic  among the remaining evo ranks W+1 … 10, the move sharing the fewest rows, columns,
//              diagonals and quadrants with the moves already chosen; ties by evo value; if none are
//              left in ranks W+1 … 10, the next-best evo move
// Overlap uses the played cell only (its mirror differs between sampled configurations at the root).
// Quadrants are the four 4×4 corners; cells on the middle row or column have none.
const FEAT = Array.from({ length: CELLS }, (_, c) => {
  const r = Math.floor(c / N), k = c % N;
  return [r, 9 + k, 18 + r - k + 8, 35 + r + k, r === 4 || k === 4 ? -1 : 52 + (r > 4) * 2 + (k > 4)];
});
function overlap(c, sel) {
  const F = FEAT[c]; let n = 0;
  for (const s of sel) { const G = FEAT[s[0]]; for (let j = 0; j < 5; j++) if (F[j] >= 0 && F[j] === G[j]) n++; }
  return n;
}
// div > 2 alternates: 3rd pick defensive again, 4th strategic again, … (each from the moves still left).
function diversify(ms, W, div) {
  const sel = ms.slice(0, W), rest = ms.slice(W).map((x, j) => [x, W + j]);   // [move, evo rank (0-based)]
  for (let k = 0; k < div && rest.length; k++) {
    let bi = 0;
    if (k % 2 === 0) { let bb = 0; for (let j = 0; j < rest.length; j++) if (rest[j][0][2] > bb + 1e-9) { bb = rest[j][0][2]; bi = j; } }
    else { let bo = Infinity; for (let j = 0; j < rest.length && rest[j][1] < 10; j++) { const o = overlap(rest[j][0][0], sel); if (o < bo) { bo = o; bi = j; } } }
    sel.push(rest.splice(bi, 1)[0][0]);
  }
  return sel;
}
function blockAt(b, map, i, v) {                       // opponent points removed by v playing i (+ mirror)
  const u = 3 - v, m = map[i];
  let x = gain(b, i, u);
  if (m !== i) { b[i] = v; x += gain(b, m, u); b[i] = 0; }
  return x;
}

function negamax(b, map, v, d, left, diff, alpha, beta, pos, beam = 0, div = 0) {
  if (!d || left <= 0) return diff;
  if (d === 1) {
    let mg = -Infinity;
    for (let i = 0; i < CELLS; i++) {
      if (b[i] || i > map[i]) continue;
      let g;
      if (pos) { g = pos(b, map, i, v); unmake(b, map, i); }
      else { g = gain(b, i, v); const m = map[i]; if (m !== i) { b[i] = v; g += gain(b, m, v); b[i] = 0; } }
      if (g > mg) mg = g;
    }
    return mg === -Infinity ? diff : diff + mg;
  }
  const ms = [];
  for (let i = 0; i < CELLS; i++) if (!b[i] && i <= map[i]) {
    const g = pos ? pos(b, map, i, v) : make(b, map, i, v); unmake(b, map, i); ms.push(div ? [i, g, blockAt(b, map, i, v)] : [i, g]);
  }
  if (!ms.length) return diff;
  if (beam && div) { shuffle(ms); ms.sort((x, y) => y[1] - x[1]); if (ms.length > beam) { const s = diversify(ms, beam, div); ms.length = 0; ms.push(...s); } }
  else if (beam) { shuffle(ms); ms.sort((x, y) => y[1] - x[1]); if (ms.length > beam) ms.length = beam; }
  else ms.sort((x, y) => y[1] - x[1]);                 // ordering only; doesn't change the value
  let best = -Infinity;
  for (const [i, g] of ms) {
    pos ? pos(b, map, i, v) : make(b, map, i, v);
    const val = -negamax(b, map, 3 - v, d - 1, left - 1, -(diff + g), -beta, -alpha, pos, beam, div);
    unmake(b, map, i);
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// Horizon-aware Evo (beamsearch_d4w5_evoh). Same search, width, candidate ranking and weights as
// beamsearch_d4w5_evo, but the leaf is valued statically as real score difference + Φh, where
//   Φh = A·(T̂_me − T̂_opp) + Bw·(L̂_me − L̂_opp)
// with r_p = turns player p still has (side to move: ceil(left/2), other: floor(left/2); 15 − moves played).
//   T̂_p  threats: the open points p could score, grouped per move (a cell and its mirror are filled by one
//        move). Undiscounted (= the Evo threat sum) while p has a turn for every scoring move; otherwise only
//        the r_p most valuable moves count. 0 when r_p = 0.
//   L̂_p  line potential: each Evo segment POT(S,k) × min(1, r_p / need), where need = the number of moves
//        that fill its empty cells (a cell whose mirror lies in the same segment counts once). 0 when r_p = 0.
// Early in the game (r_p ≥ every need) Φh equals the Evo terms; they fade out over the last turns.
// Terminal: with no moves left the value is the real score difference; with one move left it is the real
// score difference after the best-scoring move (no bonuses, no beam).
const HSTAMP = new Int32Array(CELLS), HTV = new Float64Array(CELLS); let hstamp = 0;
function threatH(b, map, p, r) {
  if (r <= 0) return 0;
  let n = 0, tot = 0;
  for (let c = 0; c < CELLS; c++) {
    const m = map[c];
    if (b[c] || m < c) continue;
    const t = gain(b, c, p) + (m !== c ? gain(b, m, p) : 0);
    if (t > 0) { HTV[n++] = t; tot += t; }
  }
  if (r >= n) return tot;
  const a = HTV.subarray(0, n).sort();
  let x = 0; for (let j = n - 1; j >= n - r; j--) x += a[j];
  return x;
}
function needMoves(b, map, L, st, en) {
  hstamp++;
  for (let j = st; j < en; j++) HSTAMP[L[j]] = hstamp;
  let need = 0;
  for (let j = st; j < en; j++) {
    const e = L[j]; if (b[e]) continue;
    const m = map[e]; if (m !== e && m < e && HSTAMP[m] === hstamp) continue;
    need++;
  }
  return need;
}
function lineH(b, map, rX, rO) {                        // X − O, horizon-discounted
  let tot = 0;
  for (let li = 0; li < LINES.length; li++) {
    const L = LINES[li], n = L.length;
    for (let p = 1; p <= 2; p++) {
      const r = p === 1 ? rX : rO; if (r <= 0) continue;
      const q = 3 - p, sg = p === 1 ? 1 : -1;
      let st = 0, k = 0;
      for (let j = 0; j <= n; j++) {
        const x = j < n ? b[L[j]] : q;
        if (x === q) {
          const S = j - st;
          if (S >= 3 && k) { const need = needMoves(b, map, L, st, j); tot += sg * POT[S * 10 + k] * (need <= r ? 1 : r / need); }
          st = j + 1; k = 0;
        } else if (x === p) k++;
      }
    }
  }
  return tot;
}
// Forced-score term (beamsearch_d4w5_evohf065). p's immediate scoring moves are distinct cell/mirror pairs with
// value t = points from playing the cell + its mirror (as in threatH). One opponent move fills exactly one pair and
// can't reduce gains elsewhere, so the best block removes p's best move and p can still take the second best:
// forced_p = t₂ (0 with fewer than 2 scoring moves). Points already on the board are excluded (t counts only new
// points). Horizon-aware: the side to move needs 2 turns left, the other side 1.
// forcedScoreDiff = forced_me − forced_opp.
function forcedScore(b, map, p) {
  let t1 = 0, t2 = 0;
  for (let c = 0; c < CELLS; c++) {
    const m = map[c];
    if (b[c] || m < c) continue;
    const t = gain(b, c, p) + (m !== c ? gain(b, m, p) : 0);
    if (t > t1) { t2 = t1; t1 = t; } else if (t > t2) t2 = t;
  }
  return t2;
}
function evalH(b, map, v, left, A, Bw, F = 0) {          // Φh (+ F·forcedScoreDiff) from the side to move's perspective
  if (left <= 0) return 0;
  const rv = (left + 1) >> 1, ru = left >> 1, l = lineH(b, map, v === 1 ? rv : ru, v === 1 ? ru : rv);
  let x = A * (threatH(b, map, v, rv) - threatH(b, map, 3 - v, ru)) + Bw * (v === 1 ? l : -l);
  if (F) x += F * ((rv >= 2 ? forcedScore(b, map, v) : 0) - (ru >= 1 ? forcedScore(b, map, 3 - v) : 0));
  return x;
}
function bestGain(b, map, v) {
  let mg = -Infinity;
  for (let i = 0; i < CELLS; i++) {
    if (b[i] || i > map[i]) continue;
    let g = gain(b, i, v); const m = map[i];
    if (m !== i) { b[i] = v; g += gain(b, m, v); b[i] = 0; }
    if (g > mg) mg = g;
  }
  return mg;
}
// sd = real score difference from v's perspective. pos (Evo) only ranks moves; values come from make + evalH.
// div > 0: the beam is diversify(top beam, div) as in negamax (beamsearch_d4w3div2_evoh); the last ply stays Evo's pick.
function negamaxH(b, map, v, d, left, sd, alpha, beta, pos, beam, A, Bw, div = 0, F = 0) {
  if (left <= 0) return sd;
  if (left === 1) { const g = bestGain(b, map, v); return g === -Infinity ? sd : sd + g; }
  if (d <= 1) {                                         // Evo picks the last move, as in beamsearch_d4w5_evo
    let mi = -1, mg = -Infinity;
    for (let i = 0; i < CELLS; i++) {
      if (b[i] || i > map[i]) continue;
      const g = pos(b, map, i, v); unmake(b, map, i);
      if (g > mg) { mg = g; mi = i; }
    }
    if (mi < 0) return sd;
    const g = make(b, map, mi, v), val = sd + g - evalH(b, map, 3 - v, left - 1, A, Bw, F);
    unmake(b, map, mi);
    return val;
  }
  const ms = [];
  for (let i = 0; i < CELLS; i++) if (!b[i] && i <= map[i]) { const g = pos(b, map, i, v); unmake(b, map, i); ms.push(div ? [i, g, blockAt(b, map, i, v)] : [i, g]); }
  if (!ms.length) return sd;
  shuffle(ms); ms.sort((x, y) => y[1] - x[1]);
  if (ms.length > beam) { if (div) { const sel = diversify(ms, beam, div); ms.length = 0; ms.push(...sel); } else ms.length = beam; }
  let best = -Infinity;
  for (const [i] of ms) {
    const g = make(b, map, i, v);
    const val = -negamaxH(b, map, 3 - v, d - 1, left - 1, -(sd + g), -beta, -alpha, pos, beam, A, Bw, div, F);
    unmake(b, map, i);
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// ISMCTS with information-gain probing (ismcts_sim200_evoh_probing).
// Single-observer ISMCTS over the public information set. Every iteration samples ONE configuration uniformly from
// the belief (never the true one), copies the board and walks the shared tree under that world: a tree action is a
// clicked cell, legal if empty (below the root also canonical under the sampled map, i.e. cell ≤ its mirror).
//   selection   UCB1 on the mover's mean value (points): W/N + c·sqrt(ln N_parent / N)
//   root bonus  + β·H(m) while the configuration is not yet identified and fewer than probeUntil moves have been
//               played. H(m) = Shannon entropy (bits) of where m's copy would land over the WHOLE belief (each
//               distinct copy cell, or "no copy", is one outcome). β = beta · log2|B| / log2(76545)
//   widening    below the root at most floor(cpw · N^alpha) actions, taken from the node's Evo ranking (computed
//               once, when the node is first visited, under that iteration's world)
//   root beam   the root searches only the top rootK = 8 moves by Evo averaged over up to 8 sampled worlds
//               (≈ 25 visits each at 200 iterations); rootK: 0 = all moves
//   expansion   the first unexpanded action in the allowed pool; it is played and the position valued with EvoH
//               (real score difference + horizon-discounted threats and line potential, evalH); one move left:
//               real score after the best-scoring reply; none left: real score difference
//   backprop    every node on the path adds the value from the view of the player who moved into it
// After sims iterations (or timeMs, if set) the most-visited root move is played (ties: higher mean).
// Root moves that every consistent configuration maps to the same lower cell are dropped (same move).
// Belief statistics (belief, per-cell outcome entropy) are cached per observed history.
const IS_DEF = { sims: 200, timeMs: 0, c: 5, beta: 0.5, probeUntil: 8, cpw: 3, alpha: 0.5, rootK: 8 };
const LOG2_ALL = Math.log2(76545), ISCACHE = new Map();
function beliefStats(history, empties) {
  const key = history.map(h => h[0] * CELLS + h[1]).join(',');
  let st = ISCACHE.get(key); if (st) return st;
  const bel = B.beliefFrom(history), n = bel.length, cnt = new Int32Array(CELLS * CELLS);
  for (let j = 0; j < n; j++) { const m = B.mapOf(bel[j]); for (let e = 0; e < empties.length; e++) { const c = empties[e]; cnt[c * CELLS + m[c]]++; } }
  const H = new Float64Array(CELLS), dup = new Uint8Array(CELLS);
  for (const c of empties) {
    let h = 0, outs = 0, only = -1;
    for (let t = 0, o = c * CELLS; t < CELLS; t++) { const k = cnt[o + t]; if (!k) continue; outs++; only = t; const p = k / n; h -= p * Math.log2(p); }
    H[c] = h; if (outs === 1 && only < c) dup[c] = 1;
  }
  st = { bel, H, dup };
  if (ISCACHE.size > 64) ISCACHE.clear();
  ISCACHE.set(key, st);
  return st;
}
function rankCells(b, map, v, pos) {
  const ms = [];
  for (let i = 0; i < CELLS; i++) if (!b[i] && i <= map[i]) { const g = pos(b, map, i, v); unmake(b, map, i); ms.push([i, g]); }
  shuffle(ms); ms.sort((x, y) => y[1] - x[1]);
  return Int16Array.from(ms, x => x[0]);
}
function chooseMoveIS(V, board, player, history, movesLeft, opts) {
  const Q = Object.assign({}, IS_DEF, V.is, opts && opts.is);
  const A = V.a, Bw = V.b, pos = makeCombo(A, Bw);
  const b0 = toArr(board), v0 = player === 'X' ? 1 : 2;
  const sc = B.score(board), diff0 = sc[player] - sc[player === 'X' ? 'O' : 'X'];
  const empties = []; for (let c = 0; c < CELLS; c++) if (!b0[c]) empties.push(c);
  const st = beliefStats(history, empties), bel = st.bel, nb = bel.length;
  const cands = empties.filter(c => !st.dup[c]);
  const sample = () => B.mapOf(bel[Math.floor(Math.random() * nb)]);
  const rmaps = []; for (let k = 0; k < Math.min(SAMPLES, nb); k++) rmaps.push(nb <= SAMPLES ? B.mapOf(bel[k]) : sample());
  if (movesLeft <= 1 || cands.length === 1) {          // last move of the game: real points only
    let best = -Infinity, picks = [];
    for (const c of cands) {
      let g = 0; for (const m of rmaps) { g += make(b0, m, c, v0); unmake(b0, m, c); }
      if (g > best + 1e-9) { best = g; picks = [c]; } else if (Math.abs(g - best) <= 1e-9) picks.push(c);
    }
    return picks[Math.floor(Math.random() * picks.length)];
  }
  const rs = shuffle(cands.map(c => { let g = 0; for (const m of rmaps) { g += pos(b0, m, c, v0); unmake(b0, m, c); } return [c, g]; }));
  rs.sort((x, y) => y[1] - x[1]);
  if (Q.rootK && rs.length > Q.rootK) rs.length = Q.rootK;   // root beam: only the top rootK moves by Evo
  const rootOrder = Int16Array.from(rs, x => x[0]);
  const probing = nb > 1 && B.MOVES_PER_ROUND - movesLeft < Q.probeUntil;
  const beta = probing ? Q.beta * Math.log2(nb) / LOG2_ALL : 0, H = st.H;
  const root = { p: 3 - v0, N: 0, W: 0, kids: new Map(), order: rootOrder };
  const b = new Int8Array(CELLS), path = [], t0 = Q.timeMs ? performance.now() : 0;
  for (let it = 0; it < Q.sims; it++) {
    if (Q.timeMs && it && performance.now() - t0 > Q.timeMs) break;
    const map = sample(); b.set(b0);
    let node = root, v = v0, left = movesLeft, sd = diff0, val;   // sd: real score difference, root player's view
    path.length = 0; path.push(root);
    for (;;) {
      if (left <= 0) { val = sd; break; }
      const isRoot = node === root;
      if (!node.order) node.order = rankCells(b, map, v, pos);
      const order = node.order, lim = isRoot ? order.length : Math.max(1, Math.floor(Q.cpw * Math.pow(node.N, Q.alpha)));
      const lnN = Math.log(Math.max(1, node.N));
      let pick = -1, fresh = -1, best = -Infinity, n = 0;
      for (let j = 0; j < order.length && n < lim; j++) {
        const c = order[j];
        if (b[c] || (!isRoot && map[c] < c)) continue;
        n++;
        const k = node.kids && node.kids.get(c);
        if (!k) { fresh = c; break; }
        let u = k.W / k.N + Q.c * Math.sqrt(lnN / k.N);
        if (isRoot && beta) u += beta * H[c];
        if (u > best) { best = u; pick = c; }
      }
      const c = fresh >= 0 ? fresh : pick;
      if (c < 0) { val = sd; break; }
      const g = make(b, map, c, v);
      sd += v === v0 ? g : -g; left--;
      if (!node.kids) node.kids = new Map();
      let child = node.kids.get(c);
      if (!child) { child = { p: v, N: 0, W: 0, kids: null, order: null }; node.kids.set(c, child); }
      path.push(child);
      const u = 3 - v;
      if (fresh >= 0) {                                   // expanded: value the new position with EvoH
        if (left <= 0) val = sd;
        else if (left === 1) { const bg = bestGain(b, map, u); val = bg === -Infinity ? sd : sd + (u === v0 ? bg : -bg); }
        else { const e = evalH(b, map, u, left, A, Bw); val = sd + (u === v0 ? e : -e); }
        break;
      }
      node = child; v = u;
    }
    for (let j = 0; j < path.length; j++) { const nd = path[j]; nd.N++; nd.W += nd.p === v0 ? val : -val; }
  }
  let bc = -1, bn = -1, bm = -Infinity;
  for (const [c, k] of root.kids) { const mean = k.W / k.N; if (k.N > bn || (k.N === bn && mean > bm)) { bc = c; bn = k.N; bm = mean; } }
  return bc >= 0 ? bc : rootOrder[0];
}

const toArr = board => Int8Array.from(board, x => (x === 'X' ? 1 : x === 'O' ? 2 : 0));

// NNUE bots (beamsearch_d3w3_nnue_pure / _hybrid). Same root sampling, root beam, width 3 and depth 3 as
// beamsearch_d3w3_evo; only the move-ranking and leaf values come from the trained network.
// Requires globals MirroNNUE9 (sim/nnue/nnue9.js) and MirroNNUE9_WEIGHTS (parsed sim/nnue/weights/nnue9_v1.json).
// The net uses side-to-move features, so two accumulators share the weights: perspective X (X marks = own)
// and perspective O. Both are copy-made on every make and popped on unmake, so restoration is exact.
// Node values are points of final score difference for the node's mover:
//   pure    V = NN
//   hybrid  V = c1·cur + c2·NN + c0, per move index (calibration in the weights file, fitted jointly on
//           validation data so NN's own estimate of the already-scored points isn't counted twice)
// Game-over nodes (no moves left) take the exact score difference in both bots.
const NNG = typeof self !== 'undefined' ? self : globalThis;
let NNS = null, LASTG = 0;
function nnState() {
  if (NNS) return NNS;
  const NN = NNG.MirroNNUE9, J = NNG.MirroNNUE9_WEIGHTS;
  if (!NN || !J) throw new Error('NNUE bots need MirroNNUE9 (sim/nnue/nnue9.js) and MirroNNUE9_WEIGHTS (sim/nnue/weights/nnue9_v1.json)');
  const w = NN.fromJSON(J);
  NNS = { nets: [null, NN.create(w), NN.create(w)], S: J.scale, MU: J.mean, cal: J.calibration ? J.calibration.byMove : null, swap: new Int8Array(CELLS) };
  return NNS;
}
function nnReset(b) {
  const s = NNS; s.nets[1].reset(b);
  for (let c = 0; c < CELLS; c++) s.swap[c] = b[c] ? 3 - b[c] : 0;
  s.nets[2].reset(s.swap);
}
function nnMake(c, m, v) { NNS.nets[1].make(c, m, v); NNS.nets[2].make(c, m, 3 - v); }
function nnUnmake() { NNS.nets[1].unmake(); NNS.nets[2].unmake(); }
function nnVal(nn, cur, left, H) {                     // node value for its mover; left = moves left incl. this one
  if (!H) return nn;
  const k = NNS.cal[B.MOVES_PER_ROUND - left];
  return k[0] * cur + k[1] * nn + k[2];
}
function nnHere(v, diff, left, H) { return nnVal(NNS.nets[v].evaluate() * NNS.S + NNS.MU, diff, left, H); }
// Value for v of v playing i (mirror map[i]); board and accumulators unchanged. Exact gain left in LASTG.
function nnChild(b, map, i, v, diff, left, H) {
  const m = map[i], u = 3 - v;
  let g = gain(b, i, v); if (m !== i) { b[i] = v; g += gain(b, m, v); b[i] = 0; }
  LASTG = g;
  if (left <= 1) return diff + g;
  return -nnVal(NNS.nets[u].evalAfter(i, m, 2) * NNS.S + NNS.MU, -(diff + g), left - 1, H);   // v's marks are "opponent" (2) for u
}
function negamaxNN(b, map, v, d, left, diff, alpha, beta, H, beam) {
  if (left <= 0) return diff;
  if (!d) return nnHere(v, diff, left, H);
  if (d === 1) {
    let mg = -Infinity;
    for (let i = 0; i < CELLS; i++) { if (b[i] || i > map[i]) continue; const x = nnChild(b, map, i, v, diff, left, H); if (x > mg) mg = x; }
    return mg === -Infinity ? nnHere(v, diff, left, H) : mg;
  }
  const ms = [];
  for (let i = 0; i < CELLS; i++) if (!b[i] && i <= map[i]) { const x = nnChild(b, map, i, v, diff, left, H); ms.push([i, x, LASTG]); }
  if (!ms.length) return nnHere(v, diff, left, H);
  if (beam) { shuffle(ms); ms.sort((x, y) => y[1] - x[1]); if (ms.length > beam) ms.length = beam; }
  else ms.sort((x, y) => y[1] - x[1]);
  let best = -Infinity;
  for (const [i, , g] of ms) {
    make(b, map, i, v); nnMake(i, map[i], v);
    const val = -negamaxNN(b, map, 3 - v, d - 1, left - 1, -(diff + g), -beta, -alpha, H, beam);
    nnUnmake(); unmake(b, map, i);
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}
function chooseMoveNN(V, board, player, history, movesLeft) {
  nnState();
  const H = V.nnue === 'hybrid', depth = V.depth, beam = V.beam || 0;
  if (H && !NNS.cal) throw new Error('nnue9_v1.json has no calibration; re-export it from NNUE Train');
  const belief = B.beliefFrom(history);
  let ids;
  if (belief.length <= SAMPLES) ids = Array.from(belief);
  else { const s = new Set(); while (s.size < SAMPLES) s.add(belief[Math.floor(Math.random() * belief.length)]); ids = [...s]; }
  const maps = ids.map(B.mapOf);
  const b = toArr(board), v = player === 'X' ? 1 : 2;
  const sc = B.score(board), diff0 = sc[player] - sc[player === 'X' ? 'O' : 'X'];
  nnReset(b);
  const cands = [];
  for (let c = 0; c < CELLS; c++) {
    if (b[c]) continue;
    const t = maps[0][c];
    if (t < c && maps.every(m => m[c] === t)) continue;
    cands.push(c);
  }
  if (beam && cands.length > beam) {
    const scored = shuffle(cands.map(c => {
      let x = 0;
      for (const m of maps) x += nnChild(b, m, c, v, diff0, movesLeft, H);
      return [c, x / maps.length];
    }));
    scored.sort((x, y) => y[1] - x[1]);
    cands.length = 0;
    for (let k = 0; k < beam; k++) cands.push(scored[k][0]);
  }
  let best = -Infinity, picks = [];
  for (const c of cands) {
    let tot = 0;
    for (const m of maps) {
      const g = make(b, m, c, v); nnMake(c, m[c], v);
      tot += -negamaxNN(b, m, 3 - v, depth - 1, movesLeft - 1, -(diff0 + g), -Infinity, Infinity, H, beam);
      nnUnmake(); unmake(b, m, c);
    }
    const val = tot / maps.length;
    if (val > best + 1e-9) { best = val; picks = [c]; } else if (Math.abs(val - best) <= 1e-9) picks.push(c);
  }
  return picks[Math.floor(Math.random() * picks.length)];
}

const VARIANTS = {
  random_d0: { random: true },                         // uniform random empty cell, no evaluation
  negamax_d1: { depth: 1 }, negamax_d2: { depth: 2 },
  negamax_d3: { depth: 3 }, negamax_d4: { depth: 4 },
  negamax_d3_threat: { depth: 3, pos: true }, negamax_d4_threat: { depth: 4, pos: true },
  negamax_d3_line: { depth: 3, line: true },
  beamsearch_d3w3: { depth: 3, beam: 3 },
  beamsearch_d3w3_softmax100: { depth: 3, beam: 3, temp: 40 },              // beamsearch_d3w3 + softmax root choice, T = 40
  beamsearch_d3w3_softmax65: { depth: 3, beam: 3, temp: 40, eps: 0.35 },    // 65% softmax100, 35% uniform random move
  beamsearch_d3w3_softmax35: { depth: 3, beam: 3, temp: 40, eps: 0.65 },    // 35% softmax100, 65% uniform random move
  beamsearch_d3w5: { depth: 3, beam: 5 },
  beamsearch_d3w3_threat: { depth: 3, beam: 3, pos: true },
  beamsearch_d3w3_combo: { depth: 3, beam: 3, combo: true },   // weights via opts {a, b} (default P.A, P.B)
  beamsearch_d3w3_evo: { depth: 3, beam: 3, combo: true, a: 0.366, b: 1.162 },   // evolved winner g09-c10 (reports/EVOLUTION_9x9.md)
  beamsearch_d2w3_evo: { depth: 2, beam: 3, combo: true, a: 0.366, b: 1.162 },   // same weights, one ply shallower
  beamsearch_d4w3_evo: { depth: 4, beam: 3, combo: true, a: 0.366, b: 1.162 },   // same weights, one ply deeper (not re-tuned)
  beamsearch_d5w3_evo: { depth: 5, beam: 3, combo: true, a: 0.366, b: 1.162 },   // depth scaling, same weights (not re-tuned)
  beamsearch_d6w3_evo: { depth: 6, beam: 3, combo: true, a: 0.366, b: 1.162 },
  beamsearch_d7w3_evo: { depth: 7, beam: 3, combo: true, a: 0.366, b: 1.162 },
  beamsearch_d8w3_evo: { depth: 8, beam: 3, combo: true, a: 0.366, b: 1.162 },
  beamsearch_d4w5_evo: { depth: 4, beam: 5, combo: true, a: 0.366, b: 1.162 },   // width vs depth, same weights
  beamsearch_d4w5_evoh: { depth: 4, beam: 5, combo: true, a: 0.366, b: 1.162, horizon: true },   // horizon-aware leaf (negamaxH)
  beamsearch_d4w2div4_evoh: { depth: 4, beam: 2, div: 4, combo: true, a: 0.366, b: 1.162, horizon: true },   // evoh leaf; evo top 2 + 2 defensive + 2 strategic
  beamsearch_d4w3div2_evoh: { depth: 4, beam: 3, div: 2, combo: true, a: 0.366, b: 1.162, horizon: true },   // evoh leaf + div2 beam (top 3 + defensive + strategic)
  ismcts_sim200_evoh_probing: { ismcts: true, a: 0.366, b: 1.162, is: { sims: 200 } },   // ISMCTS + EvoH leaves + entropy probing at the root
  ismcts_sim800_evoh_probing: { ismcts: true, a: 0.366, b: 1.162, is: { sims: 800 } },   // same, 800 iterations (≈ evoh's time per move)
  beamsearch_d3w5_evo: { depth: 3, beam: 5, combo: true, a: 0.366, b: 1.162 },   // plain width-5 control for div2
  beamsearch_d3w3div2_evo: { depth: 3, beam: 3, div: 2, combo: true, a: 0.366, b: 1.162 },   // top 3 + defensive + strategic
  beamsearch_d3w3_nnue_pure: { depth: 3, beam: 3, nnue: 'pure' },       // NNUE ranks moves and values leaves (reports/NNUE_STEP2.md)
  beamsearch_d3w3_nnue_hybrid: { depth: 3, beam: 3, nnue: 'hybrid' },   // exact score + calibrated NNUE contribution
};
VARIANTS.beamsearch_d4w5_evohf065 = { depth: 4, beam: 5, combo: true, a: 0.366, b: 1.162, horizon: true, fork: 0.65 };   // kept from the λ sweep (follow-up 21)
const LEGACY = {
  beamsearch_d3w3_softmax_mid: 'beamsearch_d3w3_softmax100', beamsearch_d3w3_softmax_high: 'beamsearch_d3w3_softmax65', D3: 'negamax_d3', D4: 'negamax_d4', D3P: 'negamax_d3_threat', D4P: 'negamax_d4_threat', D3L: 'negamax_d3_line', beamsearch_w3d3_evo: 'beamsearch_d3w3_evo' };
for (const k in LEGACY) VARIANTS[k] = VARIANTS[LEGACY[k]];

function chooseMove(name, board, player, history, movesLeft, opts) {
  const V = VARIANTS[name], depth = V.depth, beam = V.beam || 0, div = V.div || 0;
  const eps = opts && opts.eps != null ? opts.eps : V.eps || 0;
  if (V.random || (eps && Math.random() < eps)) {          // eps: share of moves played uniformly at random (…_softmax_high)
    const e = []; for (let c = 0; c < CELLS; c++) if (!board[c]) e.push(c);
    return e[Math.floor(Math.random() * e.length)];
  }
  if (V.nnue) return chooseMoveNN(V, board, player, history, movesLeft);
  if (V.ismcts) return chooseMoveIS(V, board, player, history, movesLeft, opts);
  const cA = opts && opts.a != null ? opts.a : V.a != null ? V.a : P.A, cB = opts && opts.b != null ? opts.b : V.b != null ? V.b : P.B;
  const cF = opts && opts.f != null ? opts.f : V.fork || 0;
  const pos = V.combo ? makeCombo(cA, cB) : V.pos ? makeP : V.line ? makeL : null;
  const belief = B.beliefFrom(history);
  let ids;
  if (belief.length <= SAMPLES) ids = Array.from(belief);
  else { const s = new Set(); while (s.size < SAMPLES) s.add(belief[Math.floor(Math.random() * belief.length)]); ids = [...s]; }
  const maps = ids.map(B.mapOf);
  const b = toArr(board), v = player === 'X' ? 1 : 2;
  const sc = B.score(board), diff0 = sc[player] - sc[player === 'X' ? 'O' : 'X'];
  const cands = [];
  for (let c = 0; c < CELLS; c++) {
    if (b[c]) continue;
    const t = maps[0][c];
    if (t < c && maps.every(m => m[c] === t)) continue;
    cands.push(c);
  }
  if (V.horizon && movesLeft <= 1) {                    // last move of the game: real points only
    let best = -Infinity, picks = [];
    for (const c of cands) {
      let g = 0; for (const m of maps) { g += make(b, m, c, v); unmake(b, m, c); }
      if (g > best + 1e-9) { best = g; picks = [c]; } else if (Math.abs(g - best) <= 1e-9) picks.push(c);
    }
    return picks[Math.floor(Math.random() * picks.length)];
  }
  if (beam && cands.length > beam) {                   // root beam: keep the W best by expected immediate value
    const scored = shuffle(cands.map(c => {
      let g = 0, x = 0;
      for (const m of maps) { g += pos ? pos(b, m, c, v) : make(b, m, c, v); unmake(b, m, c); if (div) x += blockAt(b, m, c, v); }
      return [c, g / maps.length, x / maps.length];
    }));
    scored.sort((x, y) => y[1] - x[1]);
    const keep = div ? diversify(scored, beam, div) : scored.slice(0, beam);
    cands.length = 0;
    for (const s of keep) cands.push(s[0]);
  }
  const temp = opts && opts.temp != null ? opts.temp : V.temp || 0, vals = temp ? [] : null;
  let best = -Infinity, picks = [];
  for (const c of cands) {
    let tot = 0;
    for (const m of maps) {
      if (V.horizon) {
        const g = make(b, m, c, v);
        tot += -negamaxH(b, m, 3 - v, depth - 1, movesLeft - 1, -(diff0 + g), -Infinity, Infinity, pos, beam, cA, cB, div, cF);
        unmake(b, m, c); continue;
      }
      const g = pos ? pos(b, m, c, v) : make(b, m, c, v);
      tot += -negamax(b, m, 3 - v, depth - 1, movesLeft - 1, -(diff0 + g), -Infinity, Infinity, pos, beam, div);
      unmake(b, m, c);
    }
    const val = tot / maps.length;
    if (vals) vals.push(val);
    if (val > best + 1e-9) { best = val; picks = [c]; } else if (Math.abs(val - best) <= 1e-9) picks.push(c);
  }
  if (vals) return softmaxPick(cands, vals, best, temp);
  return picks[Math.floor(Math.random() * picks.length)];
}
// Softmax root choice (…_softmax_* bots): P(m_i) ∝ exp((V_i − V_max) / T) over the root candidates the search
// evaluated (after the root beam), V = the search value from the mover's view, in points.
function softmaxPick(cands, vals, vmax, T) {
  let z = 0; const w = vals.map(x => { const e = Math.exp((x - vmax) / T); z += e; return e; });
  let r = Math.random() * z;
  for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) return cands[i]; }
  return cands[cands.length - 1];
}
return { chooseMove, VARIANTS, LEGACY, P, gain, make, makeP, makeL, lineVal, LINES, unmake, toArr, nnState };
