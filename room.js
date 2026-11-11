// Une "salle" : file d'attente mondiale, tours de 60 s, chat, réactions, spectateurs.
// Chaque jeu crée sa salle et ajoute ses propres messages via onAction.
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS || 5000);
const FLAGS = new Set(['🌍','🇫🇷','🇩🇿','🇲🇦','🇹🇳','🇧🇪','🇨🇭','🇨🇦','🇸🇳','🇨🇮','🇨🇲','🇲🇱','🇪🇸','🇮🇹','🇵🇹','🇩🇪','🇬🇧','🇮🇪','🇺🇸','🇧🇷','🇦🇷','🇲🇽','🇯🇵','🇰🇷','🇨🇳','🇮🇳','🇹🇷','🇪🇬','🇳🇬','🇬🇭','🇸🇪','🇳🇱','🇵🇱','🇷🇴','🇱🇧','🇸🇦','🇦🇺']);
const REACTS = new Set(['👏','😂','😱','❤️','🔥']);
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
let nextId = 1;

class Room {
  constructor(name, opts = {}) {
    this.name = name;
    this.turnMs = opts.turnMs || 60_000;
    this.handoffMs = opts.handoffMs || 3_000;
    this.opts = opts;
    this.clients = new Map();
    this.queue = [];
    this.turn = null;
    this.turnTimer = null;
    this.chatLog = [];
  }
  send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  broadcast(msg, exceptId) {
    const s = JSON.stringify(msg);
    for (const c of this.clients.values()) if (c.id !== exceptId && c.ws.readyState === 1) c.ws.send(s);
  }
  sys(text) { this.pushChat({ sys: true, text }); }
  pushChat(m) {
    m.ts = Date.now();
    this.chatLog.push(m); if (this.chatLog.length > 30) this.chatLog.shift();
    this.broadcast({ t: 'chat', m });
  }
  publicTurn() {
    const t = this.turn; if (!t) return null;
    const now = Date.now();
    return { id: t.id, name: t.name, flag: t.flag, playIn: Math.max(0, t.playAt - now), endsIn: Math.max(0, t.endsAt - now), total: this.turnMs };
  }
  queueInfo() {
    return { list: this.queue.slice(0, 8).map(id => { const c = this.clients.get(id); return { id, name: c.name, flag: c.flag }; }), ids: this.queue, total: this.queue.length };
  }
  broadcastQueue() { this.broadcast({ t: 'queue', q: this.queueInfo() }); }
  isPlaying(c) { return !!(this.turn && this.turn.id === c.id && Date.now() >= this.turn.playAt - 200); }
  startNext() {
    clearTimeout(this.turnTimer);
    const prev = this.turn;
    if (prev && this.opts.onTurnEnd) this.opts.onTurnEnd(this, prev);
    this.turn = null;
    while (this.queue.length) {
      const id = this.queue.shift();
      const c = this.clients.get(id);
      if (!c) continue;
      const now = Date.now();
      this.turn = { id, name: c.name, flag: c.flag, playAt: now + this.handoffMs, endsAt: now + this.handoffMs + this.turnMs };
      this.turnTimer = setTimeout(() => { this.sys(`⏱ Fin du tour de ${this.turn.name}`); this.startNext(); }, this.handoffMs + this.turnMs);
      break;
    }
    if (this.turn) {
      this.sys(`🎮 ${this.turn.flag} ${this.turn.name} prend la main`);
      if (this.opts.onTurnStart) this.opts.onTurnStart(this, this.turn);
    } else if (prev) this.sys('Personne dans la file… le projet attend un chef.');
    this.broadcast(Object.assign({ t: 'turn', turn: this.publicTurn() }, this.opts.turnExtra ? this.opts.turnExtra() : (this.opts.extra ? { state: this.opts.extra().state } : {})));
    this.broadcastQueue();
  }
  handle(c, msg) {
    switch (msg.t) {
      case 'hello':
        c.name = clean(msg.name, 16) || `Joueur${c.id}`;
        c.flag = FLAGS.has(msg.flag) ? msg.flag : '🌍';
        return;
      case 'join':
        if (this.queue.includes(c.id) || (this.turn && this.turn.id === c.id)) return;
        this.queue.push(c.id);
        if (!this.turn) this.startNext(); else this.broadcastQueue();
        return;
      case 'leave':
        this.queue = this.queue.filter(id => id !== c.id);
        if (this.turn && this.turn.id === c.id) { this.sys(`${c.name} passe la main`); this.startNext(); }
        else this.broadcastQueue();
        return;
      case 'chat': {
        const now = Date.now();
        if (now - (c.lastChat || 0) < 800) return;
        const text = clean(msg.text, 120); if (!text) return;
        c.lastChat = now;
        this.pushChat({ name: c.name, flag: c.flag, id: c.id, text });
        return;
      }
      case 'react': {
        const now = Date.now();
        if (now - (c.lastReact || 0) < 300 || !REACTS.has(msg.e)) return;
        c.lastReact = now;
        this.broadcast({ t: 'react', e: msg.e });
        return;
      }
      default:
        if (this.opts.onAction) this.opts.onAction(this, c, msg, this.isPlaying(c));
    }
  }
  connect(ws) {
    if (this.clients.size >= MAX_CLIENTS) { ws.close(1013, 'Serveur plein'); return; }
    const c = { ws, id: nextId++, name: 'Anonyme', flag: '🌍', alive: true };
    this.clients.set(c.id, c);
    this.send(ws, Object.assign({ t: 'init', you: c.id, turn: this.publicTurn(), queue: this.queueInfo(), viewers: this.clients.size, chat: this.chatLog, turnMs: this.turnMs }, this.opts.extra ? this.opts.extra() : {}));
    this.broadcast({ t: 'viewers', n: this.clients.size });
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw); } catch (_) { return; }
      if (msg && typeof msg.t === 'string') this.handle(c, msg);
    });
    ws.on('close', () => {
      this.clients.delete(c.id);
      this.broadcast({ t: 'viewers', n: this.clients.size });
      const wasQueued = this.queue.includes(c.id);
      this.queue = this.queue.filter(id => id !== c.id);
      if (this.turn && this.turn.id === c.id) { this.sys(`${c.name} s'est déconnecté, on passe au suivant`); this.startNext(); }
      else if (wasQueued) this.broadcastQueue();
    });
  }
  heartbeat() {
    for (const c of this.clients.values()) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false; try { c.ws.ping(); } catch (_) {}
    }
    this.broadcast({ t: 'viewers', n: this.clients.size });
  }
}

module.exports = { Room };
