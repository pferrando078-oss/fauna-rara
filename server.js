// ============================================================
// FAUNA RARA — Serveur Backend Node.js
// ============================================================
// Installation : npm install
// Démarrage    : node server.js
// ============================================================

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_live_REMPLACE_MOI');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fauna-rara-secret-change-this-in-production';

// ─── DATABASE ────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'fauna.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    balance REAL DEFAULT 5.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS owned_animals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    animal_id TEXT NOT NULL,
    bought_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, animal_id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    description TEXT,
    stripe_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Ajouter le pigeon gratuit aux nouveaux utilisateurs
const GIFT_ANIMAL = 'pigeon';

// ─── MIDDLEWARES ─────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Stripe webhook (raw body needed)
app.use('/webhook', express.raw({ type: 'application/json' }));

// Auth middleware
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  try {
    const token = header.replace('Bearer ', '');
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token invalide' });
  }
}

// ─── AUTH ROUTES ─────────────────────────────────────────────

// Inscription
app.post('/api/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const stmt = db.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)');
    const result = stmt.run(name, email.toLowerCase(), hash);
    const userId = result.lastInsertRowid;

    // Donner le pigeon gratuit
    db.prepare('INSERT OR IGNORE INTO owned_animals (user_id, animal_id) VALUES (?, ?)').run(userId, GIFT_ANIMAL);

    const token = jwt.sign({ userId, email, name }, JWT_SECRET, { expiresIn: '30d' });
    const owned = [GIFT_ANIMAL];

    res.json({ token, user: { id: userId, name, email }, balance: 5.0, owned });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      res.status(400).json({ error: 'Cet email est déjà utilisé' });
    } else {
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
});

// Connexion
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
  const owned = db.prepare('SELECT animal_id FROM owned_animals WHERE user_id = ?').all(user.id).map(r => r.animal_id);

  res.json({ token, user: { id: user.id, name: user.name, email: user.email }, balance: user.balance, owned });
});

// Profil
app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, balance FROM users WHERE id = ?').get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const owned = db.prepare('SELECT animal_id FROM owned_animals WHERE user_id = ?').all(user.id).map(r => r.animal_id);
  res.json({ user: { id: user.id, name: user.name, email: user.email }, balance: user.balance, owned });
});

// ─── ANIMALS / PURCHASE ──────────────────────────────────────

const ANIMALS = {
  pigeon: 0, hamster: 0.20, lapin: 0.50, renard: 0.80, chat: 1.00,
  lynx: 2.00, panda: 2.50, axolotl: 3.00, narval: 4.00, okapi: 5.00,
  tasmanian: 6.00, pangolin: 8.00, quetzal: 10.00, dragon: 15.00
};

// Acheter avec solde FJ
app.post('/api/buy', auth, (req, res) => {
  const { animalId } = req.body;
  if (!ANIMALS.hasOwnProperty(animalId)) {
    return res.status(400).json({ error: 'Animal inconnu' });
  }

  const price = ANIMALS[animalId];
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);

  // Vérifier si déjà possédé
  const already = db.prepare('SELECT id FROM owned_animals WHERE user_id = ? AND animal_id = ?').get(user.id, animalId);
  if (already) return res.status(400).json({ error: 'Déjà possédé' });

  if (user.balance < price) {
    return res.status(400).json({ error: 'Solde insuffisant' });
  }

  const newBalance = parseFloat((user.balance - price).toFixed(2));
  db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, user.id);
  db.prepare('INSERT INTO owned_animals (user_id, animal_id) VALUES (?, ?)').run(user.id, animalId);
  db.prepare('INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)').run(user.id, 'purchase', -price, 'Achat: '+animalId);

  res.json({ success: true, balance: newBalance });
});

// ─── STRIPE ──────────────────────────────────────────────────

// Créer un Payment Intent pour un animal
app.post('/api/create-payment-intent', auth, async (req, res) => {
  const { animalId, amount } = req.body;
  if (!ANIMALS.hasOwnProperty(animalId)) {
    return res.status(400).json({ error: 'Animal inconnu' });
  }

  try {
    const intent = await stripe.paymentIntents.create({
      amount: amount, // en centimes
      currency: 'eur',
      metadata: {
        userId: req.user.userId.toString(),
        animalId,
      },
      description: `Fauna Rara — Achat: ${animalId}`,
    });
    res.json({ clientSecret: intent.client_secret });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Recharger le portefeuille FJ via Stripe Checkout
app.post('/api/topup', auth, async (req, res) => {
  const { amount } = req.body; // en centimes
  const fjAmount = amount / 100;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Recharge ${fjAmount} Frères Jean (FJ)`, description: '1 FJ = 1 € · Utilisable pour acheter des animaux rares' },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: (process.env.FRONTEND_URL || 'http://localhost:3000') + '/success.html?fj=' + fjAmount,
      cancel_url: (process.env.FRONTEND_URL || 'http://localhost:3000') + '/',
      metadata: { userId: req.user.userId.toString(), fjAmount: fjAmount.toString() },
    });
    res.json({ sessionId: session.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Webhook Stripe (pour créditer après paiement)
app.post('/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (e) {
    return res.status(400).send('Webhook Error: ' + e.message);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = parseInt(session.metadata.userId);
    const fjAmount = parseFloat(session.metadata.fjAmount);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (user) {
      const newBalance = parseFloat((user.balance + fjAmount).toFixed(2));
      db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(newBalance, userId);
      db.prepare('INSERT INTO transactions (user_id, type, amount, description, stripe_id) VALUES (?, ?, ?, ?, ?)').run(userId, 'topup', fjAmount, 'Recharge FJ', session.id);
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const userId = parseInt(intent.metadata.userId);
    const animalId = intent.metadata.animalId;
    if (userId && animalId) {
      db.prepare('INSERT OR IGNORE INTO owned_animals (user_id, animal_id) VALUES (?, ?)').run(userId, animalId);
      db.prepare('INSERT INTO transactions (user_id, type, amount, description, stripe_id) VALUES (?, ?, ?, ?, ?)').run(userId, 'purchase', -ANIMALS[animalId], 'Achat Stripe: '+animalId, intent.id);
    }
  }

  res.json({ received: true });
});

// ─── LEADERBOARD ─────────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare(`
    SELECT u.name, COUNT(oa.animal_id) as count, GROUP_CONCAT(oa.animal_id) as animals
    FROM users u
    LEFT JOIN owned_animals oa ON u.id = oa.user_id
    GROUP BY u.id
    ORDER BY count DESC
    LIMIT 20
  `).all();
  res.json(rows);
});

// ─── SERVE FRONTEND ──────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🦁 Fauna Rara — Serveur démarré sur http://localhost:${PORT}\n`);
});
