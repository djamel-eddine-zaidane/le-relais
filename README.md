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

## Ce qu'il y a dans le projet

| Fichier | Rôle |
|---|---|
| `server.js` | Le serveur : file d'attente mondiale, chrono des tours, diffusion en direct, chat, compteur de niveaux |
| `public/index.html` | Le jeu (ce que voient les joueurs dans leur navigateur) |
| `package.json` | La liste des dépendances (une seule : `ws`, pour les WebSockets) |

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
