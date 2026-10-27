// MirroTic 9×9 (experimental) — nine 3×3 quadrants; 4 hidden mirrored pairs + 1 hidden unpaired quadrant.
// Single round: 30 moves, X starts, higher score wins.
const MirroBot = window.MirroBot9;
const N = MirroBot.N;
const MAX_MOVES = MirroBot.MOVES_PER_ROUND;
const S = 10, g = 1.4;                   // geometry units (match --u math in style9x9.css)
const W = N * S + (N - 1) * g;           // 101.2
const pos = i => i * (S + g);
const RX = 2.2;
const AI_DEPTH = 2;
MirroBot.configure({ depth: AI_DEPTH, samples: 8 });
const { findRuns, score, empties } = MirroBot;

let aiPlayer = 'O';
let aiEnabled = true;
let mode = 'ai';                         // 'ai' | 'pvp' | 'online'
// Online: host-authoritative peer-to-peer. Host holds the hidden config; guest only receives board state.
const net = { role: null, peer: null, conn: null, code: null, mySide: null, connected: false, started: false, reveal: null };
const other = p => (p === 'X' ? 'O' : 'X');
let aiTimer = null;

// Round state
let board, current, roundOver, lastMove, mirrorMap, history;
// Match state
let round = 1, roundScores = [null, null], matchOver = false;

// HIDDEN configuration: held by the engine only, used solely to place copies.
let hidden = null;
function newHiddenConfig() {
  const idx = MirroBot.randomConfig();
  hidden = { idx, map: MirroBot.mapOf(idx) };
  return hidden.map;
}
function applyMove(b, idx, player) { MirroBot.applyMove(b, idx, player, mirrorMap); }

const boardEl = document.getElementById('board');
const layer = document.getElementById('layer');
layer.setAttribute('viewBox', `0 0 ${W} ${W}`);
const cells = [];

for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell';
    b.setAttribute('role', 'gridcell');
    b.style.gridRow = r + 1;
    b.style.gridColumn = c + 1;
    if ((Math.floor(r / 3) + Math.floor(c / 3)) % 2 === 1) b.classList.add('alt'); // checkerboard of quadrants
    b.addEventListener('click', () => {
      if (mode === 'online') { onlineClick(r * N + c); return; }
      if (aiEnabled && current === aiPlayer) return;
      play(r, c);
    });
    boardEl.appendChild(b);
    cells.push(b);
  }
}

// ---------- AI ----------

const scoreEl = p => document.getElementById(p === 'X' ? 'score-x' : 'score-o');

function scheduleAi() {
  clearTimeout(aiTimer);
  scoreEl('X').classList.remove('thinking');
  scoreEl('O').classList.remove('thinking');
  if (!aiEnabled || roundOver || current !== aiPlayer) return;
  scoreEl(aiPlayer).classList.add('thinking');
  document.body.classList.add('locked');
  aiTimer = setTimeout(() => {
    scoreEl(aiPlayer).classList.remove('thinking');
    // Public information only: the board and this round's visible (cell, copy) history.
    const i = MirroBot.chooseMove(board.slice(), aiPlayer, history.map(h => h.slice()), MAX_MOVES - history.length, AI_DEPTH);
    if (i !== undefined) play(Math.floor(i / N), i % N);
  }, 550);
}

// ---------- Match flow ----------

const starterOf = n => (n === 1 ? 'X' : 'O');

function startRound(n) {
  clearTimeout(aiTimer);
  round = n;
  board = Array(N * N).fill(null);
  mirrorMap = newHiddenConfig();          // independent draw each round
  history = [];                           // bots' knowledge is rebuilt from this, so it resets too
  current = starterOf(n);
  roundOver = false;
  lastMove = [];
  net.reveal = null;
  setStatus('');
  render({});
  scheduleAi();
}

function newMatch() {
  roundScores = [null, null];
  matchOver = false;
  startRound(1);
}

function play(r, c) {
  const idx = r * N + c;
  if (roundOver || board[idx]) return;
  applyMove(board, idx, current);
  const copy = mirrorMap[idx];
  history.push([idx, copy]);
  lastMove = copy === idx ? [idx] : [idx, copy];     // unpaired quadrant: no copy
  if (history.length >= MAX_MOVES || !empties(board).length) { endRound(); return; }
  current = current === 'X' ? 'O' : 'X';
  render({ animate: true });
  scheduleAi();
}

function endRound() {
  roundOver = true;
  const s = score(board);
  roundScores[0] = { X: s.X, O: s.O };
  matchOver = true;
  if (mode === 'online' && net.role === 'host') net.reveal = MirroBot.describeConfig(hidden.idx);
  if (s.X === s.O) setStatus(`Draw, ${s.X}–${s.O}`);
  else { const w = s.X > s.O ? 'X' : 'O'; setStatus(`${w} wins, ${Math.max(s.X, s.O)}–${Math.min(s.X, s.O)}`, w); }
  render({ animate: true, showRuns: true });
}

function totals() {
  const t = { X: 0, O: 0 };
  for (const rs of roundScores) if (rs) { t.X += rs.X; t.O += rs.O; }
  return t;
}

function setStatus(text, cls = '') {
  const st = document.getElementById('status');
  st.textContent = text;
  st.className = cls;
}

// ---------- Rendering ----------

const rect = (x, y, w, h, rx = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;

function renderAreas(p) {
  let out = '';
  const at = (r, c) => r < N && c < N && board[r * N + c] === p;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (!at(r, c)) continue;
    const x = pos(c), y = pos(r);
    out += rect(x, y, S, S, RX);
    if (at(r, c + 1)) out += rect(x + S - RX, y, pos(c + 1) - x - S + 2 * RX, S);
    if (at(r + 1, c)) out += rect(x, y + S - RX, S, pos(r + 1) - y - S + 2 * RX);
    if (at(r, c + 1) && at(r + 1, c) && at(r + 1, c + 1)) {
      out += rect(x + S - RX, y + S - RX, pos(c + 1) - x - S + 2 * RX, pos(r + 1) - y - S + 2 * RX);
    }
  }
  return `<g class="area ${p}">${out}</g>`;
}

function renderSymbol(idx, p, animate) {
  const r = Math.floor(idx / N), c = idx % N;
  const x = pos(c), y = pos(r), k = 2.9;
  const isNew = animate && lastMove.includes(idx);
  const cls = `sym ${p}${isNew ? ' new' : ''}${isNew && idx === lastMove[1] ? ' mirror' : ''}`;
  const shape = p === 'X'
    ? `<path pathLength="1" d="M${x + k} ${y + k}L${x + S - k} ${y + S - k}"/><path pathLength="1" d="M${x + S - k} ${y + k}L${x + k} ${y + S - k}"/>`
    : `<circle pathLength="1" cx="${x + S / 2}" cy="${y + S / 2}" r="${S / 2 - k + 0.4}" transform="rotate(-90 ${x + S / 2} ${y + S / 2})"/>`;
  return `<g class="${cls}">${shape}</g>`;
}

function renderRuns() {
  const ctr = i => pos(i) + S / 2;
  return findRuns(board)
    .sort((a, b) => a.n - b.n)
    .map((run, k) => {
      const d = `M${ctr(run.c0)} ${ctr(run.r0)}L${ctr(run.c1)} ${ctr(run.r1)}`;
      return `<path class="run-bg" d="${d}"/><path class="run ${run.p}" pathLength="1" d="${d}" style="animation-delay:${0.5 + k * 0.12}s"/>`;
    }).join('');
}

function render({ animate = false, showRuns = false }) {
  let svg = renderAreas('X') + renderAreas('O');
  board.forEach((p, i) => { if (p) svg += renderSymbol(i, p, animate); });
  for (const i of lastMove) {
    const r = Math.floor(i / N), c = i % N;
    svg += `<circle class="last" cx="${pos(c) + S - 1.7}" cy="${pos(r) + 1.7}" r="0.6"/>`;
  }
  if (showRuns || roundOver) svg += renderRuns();
  layer.innerHTML = svg;

  cells.forEach((el, i) => {
    const p = board[i];
    el.classList.toggle('filled', !!p);
    el.disabled = !!p || roundOver;
    el.setAttribute('aria-label', `Row ${Math.floor(i / N) + 1}, column ${(i % N) + 1}: ${p || 'empty'}`);
  });

  const s = score(board);
  const sx = scoreEl('X'), so = scoreEl('O');
  sx.textContent = s.X;
  so.textContent = s.O;
  const t = totals();
  const lead = matchOver ? (t.X > t.O ? 'X' : t.O > t.X ? 'O' : null) : roundOver ? (s.X > s.O ? 'X' : s.O > s.X ? 'O' : null) : null;
  sx.classList.toggle('active', roundOver ? lead !== 'O' : current === 'X');
  so.classList.toggle('active', roundOver ? lead !== 'X' : current === 'O');

  document.getElementById('round-name').textContent =
    matchOver ? 'Game over' : `X starts · Move ${Math.min(history.length + 1, MAX_MOVES)} of ${MAX_MOVES}`;
  const online = mode === 'online';
  document.getElementById('round-sub').textContent = online && net.mySide && (net.connected || net.started)
    ? `You are ${net.mySide}` + (roundOver ? '' : current === net.mySide ? ' · your move' : ' · friend’s move')
    : '30 moves · highest score wins';
  document.getElementById('side').hidden = !aiEnabled;
  const ng = document.getElementById('new-game');
  ng.textContent = online ? 'Rematch' : 'New game';
  ng.hidden = online && !(net.connected && roundOver);
  const rv = document.getElementById('reveal');
  rv.hidden = !(online && roundOver && net.reveal);
  if (!rv.hidden) {
    const [u, pairs] = net.reveal.split('; ');
    rv.innerHTML = `<strong>Hidden rules</strong><br>${u.replace('unpaired', 'Unpaired')}<br>${pairs}`;
  }
  document.body.dataset.turn = current;
  document.body.classList.toggle('locked', roundOver || (aiEnabled && current === aiPlayer) ||
    (online && (!net.connected || current !== net.mySide)));
  if (online && net.role === 'host') sendState(animate);
}

// ---------- Online ----------

const PREFIX = 'mirrotic9-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const $ = id => document.getElementById(id);

function showNet(view, msg = '') {
  $('online').hidden = mode !== 'online';
  $('net-lobby').hidden = view !== 'lobby';
  $('net-wait').hidden = view !== 'wait';
  $('net-rejoin').hidden = view !== 'rejoin';
  $('net-code-show').textContent = net.code || '';
  $('net-msg').textContent = msg;
}

function teardown() {
  if (net.peer) { try { net.peer.destroy(); } catch (e) {} }
  Object.assign(net, { role: null, peer: null, conn: null, code: null, mySide: null, connected: false, started: false, reveal: null });
}

function sendState(animate) {
  if (!net.conn || !net.connected) return;
  const st = $('status');
  net.conn.send({
    t: 'state', board, current, moves: history.length, lastMove, roundOver, animate,
    status: { text: st.textContent, cls: st.className }, reveal: net.reveal, guestSide: other(net.mySide),
  });
}

function onlineClick(idx) {
  if (!net.connected || roundOver || current !== net.mySide || board[idx]) return;
  if (net.role === 'host') play(Math.floor(idx / N), idx % N);
  else { net.conn.send({ t: 'move', idx }); document.body.classList.add('locked'); }
}

function rematch() {
  if (!net.connected || !roundOver) return;
  if (net.role === 'host') { net.mySide = other(net.mySide); newMatch(); }   // sides alternate each game
  else net.conn.send({ t: 'rematch' });
}

function netError(e) {
  const t = e && e.type;
  if (t === 'peer-unavailable') return 'No game found with that code.';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'Can’t reach the connection service. Check your internet and try again.';
  if (t === 'browser-incompatible') return 'This browser doesn’t support online play.';
  return 'Connection failed. Try again.';
}

function hostGame() {
  if (!window.Peer) { showNet('lobby', 'Online play couldn’t load. Check your connection.'); return; }
  teardown();
  net.role = 'host';
  net.code = makeCode();
  const peer = net.peer = new Peer(PREFIX + net.code, { debug: 0 });
  showNet('wait', 'Setting up…');
  peer.on('open', () => showNet('wait', 'Waiting for your friend to join…'));
  peer.on('disconnected', () => { if (!peer.destroyed && net.peer === peer) peer.reconnect(); });
  peer.on('error', e => {
    if (net.peer !== peer) return;
    if (e.type === 'unavailable-id') { hostGame(); return; }
    if (!net.connected) { teardown(); showNet('lobby', netError(e)); }
  });
  peer.on('connection', conn => {
    if (net.connected) {
      conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); });
      return;
    }
    net.conn = conn;
    conn.on('open', () => {
      net.connected = true;
      showNet('none');
      if (!net.started) { net.started = true; net.mySide = 'X'; newMatch(); }
      else render({});                                          // friend rejoined: resend current state
    });
    conn.on('data', msg => {
      if (!msg) return;
      if (msg.t === 'move') {
        const i = msg.idx;
        if (!roundOver && current === other(net.mySide) && Number.isInteger(i) && i >= 0 && i < N * N && !board[i]) play(Math.floor(i / N), i % N);
      } else if (msg.t === 'rematch') rematch();
    });
    conn.on('close', () => {
      if (net.conn !== conn) return;
      net.connected = false; net.conn = null;
      showNet('wait', 'Your friend disconnected. They can rejoin with the same code.');
      render({});
    });
  });
}

function joinGame(code) {
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) { showNet('lobby', 'Codes are 6 characters.'); return; }
  if (!window.Peer) { showNet('lobby', 'Online play couldn’t load. Check your connection.'); return; }
  teardown();
  net.role = 'guest';
  net.code = code;
  const peer = net.peer = new Peer({ debug: 0 });
  showNet('none', 'Connecting…');
  peer.on('error', e => { if (net.peer !== peer) return; const wasIn = net.started; net.connected = false; showNet(wasIn ? 'rejoin' : 'lobby', netError(e)); render({}); });
  peer.on('open', () => {
    const conn = net.conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on('open', () => { net.connected = true; showNet('none'); });
    conn.on('data', msg => {
      if (!msg) return;
      if (msg.t === 'full') { showNet('lobby', 'That game already has two players.'); return; }
      if (msg.t !== 'state') return;
      net.started = true;
      board = msg.board; current = msg.current; history = Array(msg.moves); lastMove = msg.lastMove;
      roundOver = matchOver = msg.roundOver; net.reveal = msg.reveal; net.mySide = msg.guestSide;
      roundScores[0] = roundOver ? score(board) : null;
      setStatus(msg.status.text, msg.status.cls);
      render({ animate: msg.animate, showRuns: roundOver });
    });
    conn.on('close', () => {
      if (net.conn !== conn || net.peer !== peer) return;
      net.connected = false;
      showNet('rejoin', 'Connection lost.');
      render({});
    });
  });
}

$('net-host').addEventListener('click', hostGame);
$('net-join').addEventListener('submit', e => { e.preventDefault(); joinGame($('net-code').value); });
$('net-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('net-cancel').addEventListener('click', () => { teardown(); newMatch(); showNet('lobby'); });
$('net-rejoin').addEventListener('click', () => joinGame(net.code));
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); $('net-msg').textContent = `${label} copied.`; }
  catch (e) { $('net-msg').textContent = `Couldn’t copy. Share it manually: ${text}`; }
}
$('net-copy-code').addEventListener('click', () => copy(net.code, 'Code'));
$('net-copy-link').addEventListener('click', () => copy(`${location.origin}${location.pathname}#join=${net.code}`, 'Link'));

// ---------- Controls ----------

const info = document.getElementById('info-icon');
const desc = document.getElementById('game-description');
const showInfo = v => { desc.style.display = v ? 'flex' : 'none'; };
info.addEventListener('mouseenter', () => showInfo(true));
info.addEventListener('mouseleave', () => showInfo(false));
info.addEventListener('focus', () => showInfo(true));
info.addEventListener('blur', () => showInfo(false));

document.getElementById('new-game').addEventListener('click', () => { if (mode === 'online') rematch(); else newMatch(); });
document.querySelectorAll('#side button').forEach(btn => {
  btn.addEventListener('click', () => {
    aiPlayer = btn.dataset.side === 'X' ? 'O' : 'X';
    document.querySelectorAll('#side button').forEach(b => b.setAttribute('aria-checked', b === btn));
    newMatch();
  });
});
document.querySelectorAll('#mode button').forEach(btn => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

function setMode(m) {
  const wasOnline = mode === 'online';
  mode = m;
  aiEnabled = m === 'ai';
  document.querySelectorAll('#mode button').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === m));
  if (wasOnline || m === 'online') {
    teardown();
    newMatch();
    showNet('lobby');
  } else {
    render({});
    scheduleAi();
  }
}

newMatch();
const joinHash = location.hash.match(/join=([A-Za-z0-9]{6})/);
if (joinHash) {
  window.history.replaceState(null, '', location.pathname + location.search);
  setMode('online');
  joinGame(joinHash[1]);
}
