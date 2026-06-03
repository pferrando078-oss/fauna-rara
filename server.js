// ============================================================
// FAUNA RARA — Serveur Backend Node.js (version Render)
// ============================================================

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_REMPLACE_MOI');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fauna-rara-secret-change-this';

// ─── BASE DE DONNÉES JSON (compatible partout) ───────────────
const DB_FILE = path.join('/tmp', 'fauna-db.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch(e) {}
  return { users: [], owned: [], transactions: [] };
}

function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch(e) {}
}

let DB = loadDB();

// ─── MIDDLEWARES ─────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  try {
    req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch(e) {
    res.status(401).json({ error: 'Token invalide' });
  }
}

// ─── AUTH ────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Tous les champs sont requis' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min)' });

  DB = loadDB();
  if (DB.users.find(u => u.email === email.toLowerCase())) {
    return res.status(400).json({ error: 'Cet email est déjà utilisé' });
  }

  const hash = await bcrypt.hash(password, 10);
  const userId = Date.now().toString();
  const user = { id: userId, name, email: email.toLowerCase(), password: hash, balance: 5.0, createdAt: new Date().toISOString() };
  DB.users.push(user);
  DB.owned.push({ userId, animalId: 'pigeon' });
  saveDB(DB);

  const token = jwt.sign({ userId, email: user.email, name }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: userId, name, email: user.email }, balance: 5.0, owned: ['pigeon'] });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

  DB = loadDB();
  const user = DB.users.find(u => u.email === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
  const owned = DB.owned.filter(o => o.userId === user.id).map(o => o.animalId);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email }, balance: user.balance, owned });
});

app.get('/api/me', auth, (req, res) => {
  DB = loadDB();
  const user = DB.users.find(u => u.id === req.user.userId);
  if (!user) return res.status(404).json({ error: 'Introuvable' });
  const owned = DB.owned.filter(o => o.userId === user.id).map(o => o.animalId);
  res.json({ user: { id: user.id, name: user.name, email: user.email }, balance: user.balance, owned });
});

// ─── ACHATS ──────────────────────────────────────────────────
const ANIMALS = {
  pigeon: 0, hamster: 0.20, lapin: 0.50, renard: 0.80, chat: 1.00,
  lynx: 2.00, panda: 2.50, axolotl: 3.00, narval: 4.00, okapi: 5.00,
  tasmanian: 6.00, pangolin: 8.00, quetzal: 10.00, dragon: 15.00
};

app.post('/api/buy', auth, (req, res) => {
  const { animalId } = req.body;
  if (!ANIMALS.hasOwnProperty(animalId)) return res.status(400).json({ error: 'Animal inconnu' });

  DB = loadDB();
  const userIdx = DB.users.findIndex(u => u.id === req.user.userId);
  if (userIdx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });

  const already = DB.owned.find(o => o.userId === req.user.userId && o.animalId === animalId);
  if (already) return res.status(400).json({ error: 'Déjà possédé' });

  const price = ANIMALS[animalId];
  if (DB.users[userIdx].balance < price) return res.status(400).json({ error: 'Solde insuffisant' });

  DB.users[userIdx].balance = parseFloat((DB.users[userIdx].balance - price).toFixed(2));
  DB.owned.push({ userId: req.user.userId, animalId, boughtAt: new Date().toISOString() });
  saveDB(DB);

  res.json({ success: true, balance: DB.users[userIdx].balance });
});

// ─── STRIPE ──────────────────────────────────────────────────
app.post('/api/create-payment-intent', auth, async (req, res) => {
  const { animalId, amount } = req.body;
  if (!ANIMALS.hasOwnProperty(animalId)) return res.status(400).json({ error: 'Animal inconnu' });
  try {
    const intent = await stripe.paymentIntents.create({
      amount, currency: 'eur',
      metadata: { userId: req.user.userId, animalId },
      description: `Fauna Rara — ${animalId}`
    });
    res.json({ clientSecret: intent.client_secret });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/topup', auth, async (req, res) => {
  const { amount } = req.body;
  const fjAmount = amount / 100;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'eur', product_data: { name: `Recharge ${fjAmount} Frères Jean` }, unit_amount: amount }, quantity: 1 }],
      mode: 'payment',
      success_url: (process.env.FRONTEND_URL || 'http://localhost:3000') + '/success.html?fj=' + fjAmount,
      cancel_url: (process.env.FRONTEND_URL || 'http://localhost:3000') + '/',
      metadata: { userId: req.user.userId, fjAmount: fjAmount.toString() }
    });
    res.json({ sessionId: session.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/webhook', (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch(e) { return res.status(400).send('Webhook Error: ' + e.message); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    DB = loadDB();
    const userIdx = DB.users.findIndex(u => u.id === session.metadata.userId);
    if (userIdx !== -1) {
      DB.users[userIdx].balance = parseFloat((DB.users[userIdx].balance + parseFloat(session.metadata.fjAmount)).toFixed(2));
      saveDB(DB);
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    if (intent.metadata.userId && intent.metadata.animalId) {
      DB = loadDB();
      const exists = DB.owned.find(o => o.userId === intent.metadata.userId && o.animalId === intent.metadata.animalId);
      if (!exists) { DB.owned.push({ userId: intent.metadata.userId, animalId: intent.metadata.animalId, boughtAt: new Date().toISOString() }); saveDB(DB); }
    }
  }

  res.json({ received: true });
});

app.get('/api/leaderboard', (req, res) => {
  DB = loadDB();
  const result = DB.users.map(u => ({
    name: u.name,
    count: DB.owned.filter(o => o.userId === u.id).length,
    animals: DB.owned.filter(o => o.userId === u.id).map(o => o.animalId)
  })).sort((a, b) => b.count - a.count).slice(0, 20);
  res.json(result);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🦁 Fauna Rara — http://localhost:${PORT}`));
