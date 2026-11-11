// MS MPM — serveur multijoueur
// Une seule personne au monde joue à la fois. Tout le monde regarde.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const TURN_MS = 60_000;          // durée d'un tour
const HANDOFF_MS = 3_000;        // pause "Prêt ?" entre deux joueurs
const MIN_LEVEL_MS = 4_000;      // anti-triche : impossible de finir un niveau plus vite
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS || 5000);

// ---------- état du monde (sauvegardé sur disque) ----------
let world = { level: 1, deaths: 0, completed: 0 };
try { Object.assign(world, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (_) {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(world), () => {}), 1000);
}

// ---------- serveur HTTP (sert la page du jeu) ----------
const INDEX = path.join(__dirname, 'public', 'index.html');
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, buf) => {
      if (err) { res.writeHead(500); return res.end('Erreur'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, viewers: clients.size, level: world.level }));
  } else {
    res.writeHead(404); res.end('Introuvable');
  }
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 2048 });
const clients = new Map();   // id -> { ws, id, name, flag, lastChat, lastReact }
let queue = [];              // ids en attente, dans l'ordre
let turn = null;             // { id, name, flag, playAt, endsAt }
let turnTimer = null;
let lastState = null;        // dernière position connue du personnage
let levelStartedAt = Date.now();
const chatLog = [];          // 30 derniers messages
let nextId = 1;

const FLAGS = new Set(['🌍','🇫🇷','🇩🇿','🇲🇦','🇹🇳','🇧🇪','🇨🇭','🇨🇦','🇸🇳','🇨🇮','🇨🇲','🇲🇱','🇪🇸','🇮🇹','🇵🇹','🇩🇪','🇬🇧','🇮🇪','🇺🇸','🇧🇷','🇦🇷','🇲🇽','🇯🇵','🇰🇷','🇨🇳','🇮🇳','🇹🇷','🇪🇬','🇳🇬','🇬🇭','🇸🇪','🇳🇱','🇵🇱','🇷🇴','🇱🇧','🇸🇦','🇦🇺']);
const REACTS = new Set(['👏','😂','😱','❤️','🔥']);

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : 0;

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const c of clients.values()) if (c.id !== exceptId && c.ws.readyState === 1) c.ws.send(data);
}
function sys(text) { pushChat({ sys: true, text }); }
function pushChat(m) {
  m.ts = Date.now();
  chatLog.push(m); if (chatLog.length > 30) chatLog.shift();
  broadcast({ t: 'chat', m });
}
function publicTurn() {
  if (!turn) return null;
  const now = Date.now();
  return { id: turn.id, name: turn.name, flag: turn.flag, playIn: Math.max(0, turn.playAt - now), endsIn: Math.max(0, turn.endsAt - now), total: TURN_MS };
}
function queueInfo() {
  return { list: queue.slice(0, 8).map(id => { const c = clients.get(id); return { id, name: c.name, flag: c.flag }; }), ids: queue, total: queue.length };
}
function broadcastQueue() { broadcast({ t: 'queue', q: queueInfo() }); }

function startNext() {
  clearTimeout(turnTimer);
  const prev = turn;
  turn = null;
  while (queue.length) {
    const id = queue.shift();
    const c = clients.get(id);
    if (!c) continue;
    const now = Date.now();
    turn = { id, name: c.name, flag: c.flag, playAt: now + HANDOFF_MS, endsAt: now + HANDOFF_MS + TURN_MS };
    turnTimer = setTimeout(() => { sys(`⏱ Fin du tour de ${turn.name}`); startNext(); }, HANDOFF_MS + TURN_MS);
    break;
  }
  if (turn) sys(`🎮 ${turn.flag} ${turn.name} prend la main`);
  else if (prev) sys('Personne dans la file… le personnage attend un héros.');
  broadcast({ t: 'turn', turn: publicTurn(), state: lastState });
  broadcastQueue();
}

function handle(c, msg) {
  const isActive = turn && turn.id === c.id && Date.now() >= turn.playAt - 200;
  switch (msg.t) {
    case 'hello': {
      c.name = clean(msg.name, 16) || `Joueur${c.id}`;
      c.flag = FLAGS.has(msg.flag) ? msg.flag : '🌍';
      break;
    }
    case 'join': {
      if (queue.includes(c.id) || (turn && turn.id === c.id)) return;
      queue.push(c.id);
      if (!turn) startNext(); else broadcastQueue();
      break;
    }
    case 'leave': {
      queue = queue.filter(id => id !== c.id);
      if (turn && turn.id === c.id) { sys(`${c.name} passe la main`); startNext(); }
      else broadcastQueue();
      break;
    }
    case 'state': {
      if (!isActive || msg.level !== world.level) return;
      lastState = {
        x: num(msg.x, 0, 1e5), y: num(msg.y, -500, 2000), vx: num(msg.vx, -20, 20), vy: num(msg.vy, -20, 20),
        f: msg.f === -1 ? -1 : 1, d: num(msg.d, 0, 100), cp: !!msg.cp, level: world.level,
      };
      broadcast({ t: 'state', s: lastState }, c.id);
      break;
    }
    case 'die': {
      if (!isActive) return;
      world.deaths++; save();
      broadcast({ t: 'died', deaths: world.deaths }, c.id);
      break;
    }
    case 'win': {
      if (!isActive) return;
      if (msg.level !== world.level || Date.now() - levelStartedAt < MIN_LEVEL_MS) {
        send(c.ws, { t: 'reject' });
        return;
      }
      world.level++; world.completed++; save();
      levelStartedAt = Date.now();
      lastState = null;
      broadcast({ t: 'level', level: world.level, by: { name: c.name, flag: c.flag } });
      pushChat({ win: true, text: `🏁 ${c.flag} ${c.name} termine le niveau ${world.level - 1} !` });
      break;
    }
    case 'chat': {
      const now = Date.now();
      if (now - (c.lastChat || 0) < 800) return;
      const text = clean(msg.text, 120);
      if (!text) return;
      c.lastChat = now;
      pushChat({ name: c.name, flag: c.flag, id: c.id, text });
      break;
    }
    case 'react': {
      const now = Date.now();
      if (now - (c.lastReact || 0) < 300 || !REACTS.has(msg.e)) return;
      c.lastReact = now;
      broadcast({ t: 'react', e: msg.e });
      break;
    }
  }
}

wss.on('connection', ws => {
  if (clients.size >= MAX_CLIENTS) { ws.close(1013, 'Serveur plein'); return; }
  const c = { ws, id: nextId++, name: 'Anonyme', flag: '🌍', alive: true };
  clients.set(c.id, c);
  send(ws, { t: 'init', you: c.id, world, turn: publicTurn(), state: lastState, queue: queueInfo(), viewers: clients.size, chat: chatLog, turnMs: TURN_MS });
  broadcast({ t: 'viewers', n: clients.size });
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
    if (msg && typeof msg.t === 'string') handle(c, msg);
  });
  ws.on('close', () => {
    clients.delete(c.id);
    broadcast({ t: 'viewers', n: clients.size });
    const wasQueued = queue.includes(c.id);
    queue = queue.filter(id => id !== c.id);
    if (turn && turn.id === c.id) { sys(`${c.name} s'est déconnecté, on passe au suivant`); startNext(); }
    else if (wasQueued) broadcastQueue();
  });
});

// Nettoie les connexions mortes et envoie le nombre de spectateurs
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false; try { c.ws.ping(); } catch (_) {}
  }
  broadcast({ t: 'viewers', n: clients.size });
}, 5000);

server.listen(PORT, () => console.log(`MS MPM tourne sur http://localhost:${PORT} — niveau ${world.level}`));
