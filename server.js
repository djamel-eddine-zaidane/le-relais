// MS MPM — serveur multijoueur
// Trois jeux sur le même serveur :
//   /           Le Relais maritime  (plateforme, un seul joueur au monde à la fois)
//   /projet     Le Chantier         (gestion de projet en relais)
//   /formation  Serious game        (solo, aucun serveur nécessaire)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Room } = require('./room');
const createProjet = require('./projet');

const PORT = process.env.PORT || 3000;
const MIN_LEVEL_MS = 4_000;      // anti-triche : impossible de finir un niveau plus vite
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

// ---------- données sauvegardées ----------
let data = {};
try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) {}
if (data.level) data = { relais: { level: data.level, deaths: data.deaths || 0, completed: data.completed || 0 } }; // ancien format
data.relais = Object.assign({ level: 1, deaths: 0, completed: 0 }, data.relais);
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(data), () => {}), 1000);
}

// ---------- pages ----------
const PAGES = { '/': 'index.html', '/index.html': 'index.html', '/relais': 'relais.html', '/projet': 'projet.html', '/formation': 'formation.html' };
const STATIC = { '/og.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (PAGES[url]) {
    fs.readFile(path.join(__dirname, 'public', PAGES[url]), (err, buf) => {
      if (err) { res.writeHead(500); return res.end('Erreur'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  } else if (STATIC[url]) {
    fs.readFile(path.join(__dirname, 'public', url.slice(1)), (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': STATIC[url], 'Cache-Control': 'public, max-age=86400' });
      res.end(buf);
    });
  } else if (url === '/api/stats') {
    const p = data.projet;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      relais: { viewers: relais.clients.size, level: data.relais.level, deaths: data.relais.deaths, playing: relais.turn ? `${relais.turn.flag} ${relais.turn.name}` : null },
      projet: { viewers: projet.room.clients.size, ship: p.ship, week: p.week, delivered: data.projetDelivered || 0, playing: projet.room.turn ? `${projet.room.turn.flag} ${projet.room.turn.name}` : null },
    }));
  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, relais: relais.clients.size, projet: projet.room.clients.size, level: data.relais.level }));
  } else {
    res.writeHead(404); res.end('Introuvable');
  }
});

// ---------- Jeu 1 : le relais maritime ----------
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : 0;
let lastState = null;
let levelStartedAt = Date.now();
const relais = new Room('relais', {
  extra: () => ({ world: data.relais, state: lastState }),
  onAction(room, c, msg, isActive) {
    const world = data.relais;
    switch (msg.t) {
      case 'state':
        if (!isActive || msg.level !== world.level) return;
        lastState = {
          x: num(msg.x, 0, 1e5), y: num(msg.y, -500, 2000), vx: num(msg.vx, -20, 20), vy: num(msg.vy, -20, 20),
          f: msg.f === -1 ? -1 : 1, d: num(msg.d, 0, 100), cp: !!msg.cp, level: world.level,
        };
        room.broadcast({ t: 'state', s: lastState }, c.id);
        break;
      case 'die':
        if (!isActive) return;
        world.deaths++; save();
        room.broadcast({ t: 'died', deaths: world.deaths }, c.id);
        break;
      case 'win':
        if (!isActive) return;
        if (msg.level !== world.level || Date.now() - levelStartedAt < MIN_LEVEL_MS) { room.send(c.ws, { t: 'reject' }); return; }
        world.level++; world.completed++; save();
        levelStartedAt = Date.now();
        lastState = null;
        room.broadcast({ t: 'level', level: world.level, by: { name: c.name, flag: c.flag } });
        room.pushChat({ win: true, text: `🏁 ${c.flag} ${c.name} valide l'étape ${world.level - 1} !` });
        break;
    }
  },
});

// ---------- Jeu 2 : le chantier (gestion de projet) ----------
const projet = createProjet(data, save);

// ---------- WebSocket : une salle par jeu ----------
const ROUTES = { '/': relais, '/ws/projet': projet.room };
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
server.on('upgrade', (req, socket, head) => {
  const room = ROUTES[req.url.split('?')[0]];
  if (!room) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => room.connect(ws));
});

setInterval(() => { relais.heartbeat(); projet.room.heartbeat(); }, 5000);

server.listen(PORT, () => console.log(`MS MPM tourne sur http://localhost:${PORT}`));
