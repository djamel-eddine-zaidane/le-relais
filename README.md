# MS MPM

**Management de Projets Maritimes**, en relais mondial.

Un seul chef de chantier au monde joue à la fois. Tout le monde regarde.
Chacun a 60 secondes pour faire avancer le projet, puis passe la main.
Objectif commun : valider 1 000 000 d'étapes.

## L'univers

- Chaque niveau est une **étape d'un projet de construction navale** : étude de faisabilité, conception, achat de l'acier, découpe, assemblage des blocs, construction en cale, mise à l'eau, armement, essais en mer, livraison.
- Toutes les 10 étapes, un **navire est livré** (porte-conteneurs, ferry, méthanier…).
- Chaque étape peut subir un **aléa** :
  - 🌊 Tempête : le vent repousse le chef de chantier.
  - 🌫️ Brouillard : visibilité réduite.
  - 🌙 Travail de nuit.
  - 📋 Inspection de la classification : pas de jalon intermédiaire, il faut tout faire d'une traite.
- Les plots orange sont les obstacles du chantier ; tomber dans le bassin renvoie au dernier jalon.

## Les trois jeux

| Adresse | Jeu | Principe |
|---|---|---|
| `/` | 🏠 **Accueil** | Présente les trois jeux, avec l'activité en direct (qui joue, combien de personnes en ligne). |
| `/relais` | 🏗️ **Le Relais** | Jeu de plateforme sur un chantier naval. Un seul joueur au monde, 60 s chacun, 1 000 000 d'étapes à valider ensemble. |
| `/projet` | 📊 **Le Chantier** | Gestion de projet en relais. Le joueur pilote la construction d'un navire pendant 60 s (= 12 semaines) : équipes, heures sup, audits, aléas. Le suivant hérite de ses décisions. |
| `/formation` | 🎓 **Formation** | Serious game solo. 4 projets (navire, terminal portuaire, parc éolien en mer, décarbonation d'un ferry), 6 décisions chacun, avec explication, débriefing et glossaire. |

## Ce qu'il y a dans le projet

| Fichier | Rôle |
|---|---|
| `server.js` | Le serveur web : sert les pages et dirige chaque joueur vers la bonne salle |
| `room.js` | Une salle : file d'attente mondiale, tours de 60 s, chat, réactions, spectateurs |
| `projet.js` | La simulation du Chantier (planning, budget, qualité, moral, aléas, score) |
| `public/index.html` | L'accueil |
| `public/relais.html` | Le Relais (sons, alerte quand c'est ton tour) |
| `public/og.png` | L'image d'aperçu quand on partage le lien (LinkedIn, WhatsApp…) |
| `public/projet.html` | Le Chantier |
| `public/formation.html` | La Formation (fonctionne sans serveur) |
| `package.json` | La liste des dépendances (une seule : `ws`, pour les WebSockets) |

## Le Chantier : les règles

- Le projet : livrer un navire avant la **semaine 40**, avec **120 M€**, en gardant qualité et moral au plus haut.
- 4 phases : Conception → Achats → Construction → Essais en mer. Chacune avance grâce à son équipe (Ingénierie, Achats, Production, Qualité/HSE).
- 8 équipes au maximum, 0,4 M€ par équipe et par semaine. Une équipe sur la mauvaise phase coûte sans rien produire.
- Les aléas (grève, retard moteur, défaut de soudure, eaux de ballast…) demandent une décision. Si personne ne tranche en 4 semaines, l'option par défaut s'applique, souvent la pire.
- À la livraison, un score combine délai, budget restant, qualité et moral. Les 10 derniers navires livrés sont affichés.
- Le panneau **Valeur acquise** montre en direct la courbe prévu / réalisé / dépensé, le CPI (coût), le SPI (délai), le coût final prévu et la date de fin prévue.

## Tester sur ton ordinateur

1. Installe [Node.js](https://nodejs.org) (version 18 ou plus récente).
2. Dans un terminal, va dans le dossier du projet puis tape :
   ```
   npm install
   npm start
   ```
3. Ouvre http://localhost:3000 dans **deux onglets** : tu verras d'un côté le joueur, de l'autre un spectateur.

## Mettre le jeu en ligne gratuitement (Render)

1. **Mets le projet sur GitHub**
   Sur github.com, clique sur **New repository**, nomme-le `le-relais`, puis clique sur **uploading an existing file** et glisse tous les fichiers du projet (en gardant le dossier `public`).
2. **Crée un compte sur [render.com](https://render.com)** en te connectant avec GitHub.
3. Dans Render : **New → Web Service**, puis choisis ton dépôt `le-relais`.
4. Remplis :
   - **Runtime** : Node
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : Free
5. Clique sur **Deploy**. Après une ou deux minutes, Render te donne une adresse du type `https://le-relais-xxxx.onrender.com`. Partage-la : tout le monde jouera dans la même file mondiale.

À chaque modification envoyée sur GitHub, Render remet le jeu à jour automatiquement.

### Limites de l'offre gratuite de Render

- Le serveur **s'endort après 15 minutes sans visiteur**. Le premier visiteur suivant attend jusqu'à une minute qu'il se réveille.
- Le disque n'est **pas permanent** : quand le serveur redémarre, le compteur de niveaux repart à 1. Pour le garder pour toujours, il faudra brancher une base de données (prochaine étape possible).

## Règles appliquées par le serveur

- Une seule personne contrôle le personnage ; les autres reçoivent sa position en direct.
- Tours de 60 secondes, avec 3 secondes de « Prêt ? » entre deux joueurs. Le personnage reste là où le joueur précédent l'a laissé.
- Si le joueur actif se déconnecte ou passe la main, le suivant prend sa place immédiatement.
- Anti-triche simple : seul le joueur actif peut valider un niveau, et pas en moins de 4 secondes.
- Chat limité (un message toutes les 0,8 s, 120 caractères max), réactions limitées.
- Les niveaux sont générés à partir de leur numéro : le niveau 42 est le même pour tout le monde.

## Réglages (variables d'environnement, facultatives)

| Variable | Par défaut | Effet |
|---|---|---|
| `PORT` | 3000 | Port du serveur (Render le fixe tout seul) |
| `DATA_FILE` | `data.json` | Où sauvegarder le niveau et le nombre de morts |
| `MAX_CLIENTS` | 5000 | Nombre maximum de connexions simultanées |
