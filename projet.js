// Jeu 2 : Le Chantier — gestion de projet de construction navale, en relais mondial.
// Une seule personne pilote le projet pendant 60 s (= 12 semaines de projet).
// Le joueur suivant hérite de ses décisions… et de leurs conséquences.
const { Room } = require('./room');

const WEEK_MS = 5_000;                 // 1 semaine de projet = 5 s de jeu
const MAX_TEAMS = 8;
const PHASES = ['Conception', 'Achats', 'Construction', 'Essais en mer'];
const REL = ['ing', 'ach', 'prod', 'qhse'];      // équipe qui fait avancer chaque phase
const WORK = [32, 24, 80, 24];                   // charge de chaque phase, en équipes-semaines
const TEAM_COST = 0.4;                           // M€ par équipe et par semaine
const SHIPS = ['Porte-conteneurs', 'Ferry', 'Pétrolier', 'Vraquier', 'Navire de recherche', 'Remorqueur', 'Méthanier', 'Paquebot', 'Patrouilleur', 'Câblier'];

// Aléas : l'option "def" s'applique d'office si personne ne tranche en 4 semaines.
const EVENTS = [
  { id: 'acier', title: '📈 Hausse du prix de l\'acier', text: 'Le prix de la tôle d\'acier bondit de 15 %. Le fournisseur garantit l\'ancien prix encore une semaine.',
    options: [{ label: 'Commander tout l\'acier maintenant (−4 M€)', eff: { budget: -4 } }, { label: 'Attendre une baisse (−2 M€, +2 semaines)', eff: { budget: -2, delay: 2 } }], def: 1 },
  { id: 'moteur', title: '🚚 Retard du moteur principal', text: 'Le motoriste annonce 3 semaines de retard sur la livraison du moteur.',
    options: [{ label: 'Payer un transport express (−4 M€)', eff: { budget: -4 } }, { label: 'Accepter le retard (+3 semaines)', eff: { delay: 3 } }], def: 1 },
  { id: 'greve', title: '✊ Grève des soudeurs', text: 'Les soudeurs réclament une prime de pénibilité.',
    options: [{ label: 'Négocier une prime (−3 M€, moral +15)', eff: { budget: -3, morale: 15 } }, { label: 'Attendre la fin du mouvement (+2 semaines, moral −10)', eff: { delay: 2, morale: -10 } }], def: 1 },
  { id: 'avenant', title: '✍️ L\'armateur veut une modification', text: 'Le client demande une cabine supplémentaire. Il est prêt à signer un avenant.',
    options: [{ label: 'Accepter avec avenant payé (+5 M€, +2 semaines)', eff: { budget: 5, delay: 2 } }, { label: 'Refuser poliment (qualité perçue −3)', eff: { quality: -3 } }], def: 1 },
  { id: 'soudure', title: '🔍 Défaut de soudure', text: 'La société de classification relève des soudures non conformes sur un bloc.',
    options: [{ label: 'Reprendre les soudures (−3 M€, +1 semaine, qualité +10)', eff: { budget: -3, delay: 1, quality: 10 } }, { label: 'Demander une dérogation (qualité −15)', eff: { quality: -15 } }], def: 1 },
  { id: 'tempete', title: '🌊 Tempête sur le chantier', text: 'Vents violents annoncés pour 48 h. Les grues doivent être arrêtées.',
    options: [{ label: 'Arrêter et sécuriser le chantier (−1 M€, +1 semaine)', eff: { budget: -1, delay: 1 } }, { label: 'Continuer au maximum (moral −10, qualité −5)', eff: { morale: -10, quality: -5 } }], def: 1 },
  { id: 'ballast', title: '🧪 Eaux de ballast', text: 'La convention de l\'OMI sur les eaux de ballast impose un système de traitement à bord.',
    options: [{ label: 'L\'intégrer dès maintenant (−4 M€, qualité +5)', eff: { budget: -4, quality: 5 } }, { label: 'Le prévoir après livraison (qualité −12)', eff: { quality: -12 } }], def: 1 },
  { id: 'ingenieur', title: '👷 Départ d\'un ingénieur clé', text: 'L\'ingénieur responsable de la structure quitte l\'entreprise.',
    options: [{ label: 'Faire appel à un consultant (−2 M€)', eff: { budget: -2 } }, { label: 'Répartir sa charge (moral −8, +1 semaine)', eff: { morale: -8, delay: 1 } }], def: 1 },
  { id: 'grue', title: '🏗️ Panne de la grue portique', text: 'La grande grue du chantier est en panne pour 2 semaines.',
    options: [{ label: 'Louer une grue mobile (−2 M€)', eff: { budget: -2 } }, { label: 'Attendre la réparation (+2 semaines)', eff: { delay: 2 } }], def: 1 },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = v => Math.round(v * 10) / 10;

function newProject(n) {
  const k = n - 1;
  return {
    n, ship: `${SHIPS[k % SHIPS.length]} n°${Math.floor(k / SHIPS.length) + 1}`,
    week: 0, deadline: 40, budget: 120, spent: 0, quality: 80, morale: 80,
    phases: [0, 0, 0, 0], teams: { ing: 3, ach: 1, prod: 1, qhse: 1 }, overtime: false,
    event: null, nextEventIn: 4, auditCd: 0, trainCd: 0, log: [], done: false,
  };
}

module.exports = function createProjet(data, save) {
  if (!data.projet || data.projet.done) data.projet = newProject(data.projet ? data.projet.n + 1 : 1);
  data.projetHistory = data.projetHistory || [];
  let tick = null, turnStart = null;
  const P = () => data.projet;

  function log(text) { const p = P(); p.log.unshift({ w: p.week, text }); p.log = p.log.slice(0, 12); }
  function push() { room.broadcast({ t: 'projet', p: P() }); }
  function progress(p) { return p.phases.reduce((s, v, i) => s + v * WORK[i], 0) / WORK.reduce((a, b) => a + b, 0); }

  function applyEffects(p, eff) {
    if (eff.budget) p.budget += eff.budget;
    if (eff.delay) p.week += eff.delay;
    if (eff.quality) p.quality = clamp(p.quality + eff.quality, 0, 100);
    if (eff.morale) p.morale = clamp(p.morale + eff.morale, 0, 100);
  }

  function weekTick() {
    const p = P(); if (p.done) return;
    p.week++;
    const ph = p.phases.findIndex(v => v < 100);
    const mf = 0.6 + 0.4 * p.morale / 100;
    const ot = p.overtime ? 1.4 : 1;
    p.phases[ph] = Math.min(100, p.phases[ph] + p.teams[REL[ph]] * 100 / WORK[ph] * mf * ot);
    // ingénierie concourante : l'équipe de la phase suivante peut prendre de l'avance, sans dépasser la phase en cours
    if (ph < 3) { const nx = ph + 1; p.phases[nx] = Math.min(p.phases[ph] * 0.9, p.phases[nx] + p.teams[REL[nx]] * 100 / WORK[nx] * mf * ot * 0.5); }
    const nTeams = Object.values(p.teams).reduce((a, b) => a + b, 0);
    const cost = nTeams * TEAM_COST * (p.overtime ? 1.5 : 1);
    p.budget -= cost; p.spent += cost;
    p.quality += (ph === 2 ? (p.teams.qhse >= 1 ? 0.4 : -1.5) : (p.teams.qhse >= 1 ? 0.2 : -0.3)) - (p.overtime ? 0.5 : 0);
    p.morale += p.overtime ? -3 : 1;
    const risk = 0.01 + (p.overtime ? 0.03 : 0) + (p.teams.qhse === 0 ? 0.03 : 0) + (p.morale < 40 ? 0.03 : 0);
    if (Math.random() < risk) { p.morale -= 10; p.budget -= 3; log('🚑 Accident sur le chantier : arrêt, enquête, −3 M€, moral en baisse'); room.sys('🚑 Accident sur le chantier !'); }
    if (p.event) {
      p.event.age++;
      if (p.event.age >= 4) {
        const ev = EVENTS.find(e => e.id === p.event.id);
        applyEffects(p, ev.options[ev.def].eff);
        log(`⚖️ ${ev.title} : personne n'a tranché, option par défaut « ${ev.options[ev.def].label} »`);
        p.event = null; p.nextEventIn = 4 + Math.floor(Math.random() * 4);
      }
    } else if (--p.nextEventIn <= 0) {
      const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
      p.event = { id: ev.id, title: ev.title, text: ev.text, options: ev.options.map(o => o.label), age: 0 };
      room.sys(`⚠️ Nouvel aléa : ${ev.title}`);
    }
    if (p.auditCd > 0) p.auditCd--;
    if (p.trainCd > 0) p.trainCd--;
    p.quality = r1(clamp(p.quality, 0, 100)); p.morale = r1(clamp(p.morale, 0, 100)); p.budget = r1(p.budget); p.spent = r1(p.spent);
    p.phases = p.phases.map(r1);
    if (p.phases.every(v => v >= 100)) deliver();
    push();
  }

  function deliver() {
    const p = P();
    p.done = true;
    const late = Math.max(0, p.week - p.deadline), overrun = Math.max(0, -p.budget);
    const score = Math.max(0, Math.round(500 + p.quality * 3 + p.morale - late * 15 - overrun * 8 + Math.max(0, p.budget) * 2));
    const rec = { n: p.n, ship: p.ship, weeks: p.week, late, budget: r1(p.budget), quality: Math.round(p.quality), score, at: Date.now() };
    data.projetHistory.unshift(rec); data.projetHistory = data.projetHistory.slice(0, 10);
    room.pushChat({ win: true, text: `🚢 ${p.ship} livré en ${p.week} semaines ! Score : ${score}` });
    room.broadcast({ t: 'delivered', rec, history: data.projetHistory });
    data.projet = newProject(p.n + 1);
    log(`Nouveau projet : ${data.projet.ship}. Échéance : semaine 40, budget : 120 M€.`);
    save();
  }

  const room = new Room('projet', {
    extra: () => ({ p: P(), history: data.projetHistory, weekMs: WEEK_MS }),
    turnExtra: () => ({ p: P() }),
    onTurnStart(r, turn) {
      const p = P();
      turnStart = { week: p.week, budget: p.budget, prog: progress(p) };
      clearInterval(tick);
      setTimeout(() => { if (r.turn === turn) tick = setInterval(weekTick, WEEK_MS); }, r.handoffMs);
    },
    onTurnEnd(r, turn) {
      clearInterval(tick); tick = null;
      const p = P();
      if (turnStart && !p.done) {
        r.sys(`📊 Bilan de ${turn.name} : semaines ${turnStart.week}→${p.week}, avancement +${Math.max(0, Math.round(progress(p) - turnStart.prog))} %, budget ${r1(p.budget - turnStart.budget)} M€`);
      }
      turnStart = null; save();
    },
    onAction(r, c, msg, playing) {
      if (msg.t !== 'act' || !playing) return;
      const p = P(); if (p.done) return;
      switch (msg.a) {
        case 'team': {
          const k = msg.team, d = msg.d === 1 ? 1 : -1;
          if (!REL.includes(k)) return;
          const total = Object.values(p.teams).reduce((a, b) => a + b, 0);
          if (d > 0 && (total >= MAX_TEAMS || p.teams[k] >= 5)) return;
          if (d < 0 && p.teams[k] <= 0) return;
          p.teams[k] += d;
          break;
        }
        case 'overtime':
          p.overtime = !p.overtime;
          log(p.overtime ? `⏰ ${c.name} lance les heures supplémentaires` : `🛑 ${c.name} arrête les heures supplémentaires`);
          break;
        case 'audit':
          if (p.auditCd > 0) return;
          p.budget = r1(p.budget - 2); p.quality = clamp(p.quality + 8, 0, 100); p.auditCd = 6;
          log(`🔎 ${c.name} commande un audit qualité (−2 M€, qualité +8)`);
          break;
        case 'train':
          if (p.trainCd > 0) return;
          p.budget = r1(p.budget - 1.5); p.morale = clamp(p.morale + 10, 0, 100); p.trainCd = 6;
          log(`🦺 ${c.name} organise une formation sécurité (−1,5 M€, moral +10)`);
          break;
        case 'event': {
          if (!p.event || ![0, 1].includes(msg.choice)) return;
          const ev = EVENTS.find(e => e.id === p.event.id);
          applyEffects(p, ev.options[msg.choice].eff);
          log(`✅ ${c.name} tranche « ${ev.title} » : ${ev.options[msg.choice].label}`);
          p.event = null; p.nextEventIn = 4 + Math.floor(Math.random() * 4);
          break;
        }
        default: return;
      }
      push();
    },
  });

  return { room, _weekTick: weekTick, _data: data };
};
