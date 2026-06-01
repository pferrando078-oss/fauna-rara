# 🦁 FAUNA RARA — Guide de déploiement complet

## Ce que tu as reçu
Un site complet avec :
- ✅ Page boutique avec 14 animaux
- ✅ Inscription / connexion sécurisée
- ✅ Vrai paiement Stripe (carte bancaire)
- ✅ Portefeuille "Frères Jean"
- ✅ Page collection personnelle
- ✅ Classement communauté
- ✅ Conseils IA (Claude)
- ✅ Base de données SQLite

---

## ÉTAPE 1 — Préparer tes clés Stripe

1. Va sur https://stripe.com et crée un compte gratuit
2. Dans le tableau de bord → **Développeurs → Clés API**
3. Copie :
   - **Clé publique** (commence par `pk_live_...`)
   - **Clé secrète** (commence par `sk_live_...`)

---

## ÉTAPE 2 — Modifier les clés dans les fichiers

### Dans `public/index.html` (ligne ~310)
```
const STRIPE_PK = 'pk_live_REMPLACE_MOI';
```
→ Remplace par ta vraie clé publique Stripe.

### Dans `server.js` (ligne ~15)
```
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_live_REMPLACE_MOI');
```
→ Tu pourras mettre la variable d'environnement (voir étape 4).

---

## ÉTAPE 3 — Tester en local (sur ton ordinateur)

### Installer Node.js
Télécharge sur https://nodejs.org (version LTS)

### Lancer le site
Ouvre un terminal dans le dossier `fauna-rara` et tape :
```bash
npm install
node server.js
```
→ Ouvre http://localhost:3000 dans ton navigateur. Le site tourne !

---

## ÉTAPE 4 — Mettre en ligne (URL publique)

### Option A — Render.com (GRATUIT, recommandé)

1. Crée un compte sur https://render.com
2. Clique **New → Web Service**
3. Connecte ton GitHub (glisse le dossier fauna-rara sur GitHub d'abord)
4. Paramètres :
   - **Build Command** : `npm install`
   - **Start Command** : `node server.js`
5. Variables d'environnement (onglet Environment) :
   ```
   STRIPE_SECRET_KEY = sk_live_TON_VRAI_SECRET
   JWT_SECRET = une_longue_phrase_secrete_aleatoire_ici
   FRONTEND_URL = https://ton-app.onrender.com
   ```
6. Clique **Deploy** → tu reçois une URL comme `https://fauna-rara.onrender.com` 🎉

### Option B — Railway.app (aussi gratuit)
1. https://railway.app → New Project → Deploy from GitHub
2. Même variables d'environnement qu'au-dessus

### Option C — VPS (Hostinger, OVH...)
Si tu as un hébergement VPS :
```bash
git clone ton_repo
npm install
# Utilise pm2 pour garder le serveur actif
npm install -g pm2
pm2 start server.js --name fauna-rara
```

---

## ÉTAPE 5 — Configurer le webhook Stripe

Pour que les paiements soient automatiquement crédités :

1. Stripe → Développeurs → Webhooks → **Ajouter un endpoint**
2. URL : `https://ton-site.com/webhook`
3. Événements à écouter :
   - `checkout.session.completed`
   - `payment_intent.succeeded`
4. Copie le **Secret de signature** → ajoute-le en variable d'environnement :
   ```
   STRIPE_WEBHOOK_SECRET = whsec_...
   ```

---

## ÉTAPE 6 — Nom de domaine (optionnel)

Sur Render, va dans Settings → Custom Domain → entre ton domaine (ex: fauna-rara.fr)
Ton registrar de domaine (Namecheap, OVH, Gandi...) doit pointer vers Render.

---

## Structure des fichiers

```
fauna-rara/
├── public/
│   ├── index.html      ← Le site complet (frontend)
│   └── success.html    ← Page après paiement Stripe
├── server.js           ← Backend Node.js (API + Stripe + DB)
├── package.json        ← Dépendances Node.js
├── GUIDE.md            ← Ce fichier
└── fauna.db            ← Base de données (créée automatiquement)
```

---

## Questions fréquentes

**Q : Les paiements fonctionnent-ils en mode test ?**
R : Oui ! Utilise les clés `pk_test_...` et `sk_test_...` pour tester sans vrai argent. Carte test : 4242 4242 4242 4242.

**Q : Où sont stockées les données utilisateurs ?**
R : Dans le fichier `fauna.db` (SQLite) sur ton serveur. Sauvegarde ce fichier régulièrement.

**Q : Puis-je ajouter plus d'animaux ?**
R : Oui ! Dans `index.html`, modifie le tableau `ANIMALS` et dans `server.js`, modifie l'objet `ANIMALS`.

**Q : L'IA (Claude) fonctionne-t-elle sans serveur ?**
R : Oui, les conseils IA appelent directement l'API Anthropic depuis le navigateur. Ça marchera dès que le site est en ligne.

---

## Support
Pour toute question, reviens ici et demande à Claude ! 🌿
