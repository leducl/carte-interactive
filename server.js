// Serveur du site "Carte Interactive New York".
// Zéro dépendance : uniquement la bibliothèque standard de Node.
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(DATA_DIR, 'poi-seed.json');

// Les 4 comptes de l'équipe, avec des mots de passe volontairement simples.
// En production, définissez la variable d'environnement ACCOUNTS pour les remplacer,
// au format « axel:motdepasse,simon:autremotdepasse ».
const DEFAULT_ACCOUNTS = {
  axel: 'axel2026',
  simon: 'simon2026',
  bastien: 'bastien2026',
  leo: 'leo2026',
};

function parseAccounts(raw) {
  const parsed = {};
  for (const entry of raw.split(',')) {
    const separator = entry.indexOf(':');
    if (separator < 1) continue;
    const name = entry.slice(0, separator).trim().toLowerCase();
    const password = entry.slice(separator + 1).trim();
    if (name && password) parsed[name] = password;
  }
  return parsed;
}

const ACCOUNTS = process.env.ACCOUNTS ? parseAccounts(process.env.ACCOUNTS) : DEFAULT_ACCOUNTS;
if (!Object.keys(ACCOUNTS).length) {
  console.error('ACCOUNTS est défini mais illisible. Format attendu : « axel:motdepasse,simon:autre ».');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Base de données (un simple fichier JSON, écrit de façon atomique)    */
/* ------------------------------------------------------------------ */

let db = null;
let writeQueue = Promise.resolve();

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

function checkPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, 32).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function loadSeed() {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  return seed.map((p) => ({
    id: crypto.randomUUID(),
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    category: p.cat,
    duration: p.dur,
    description: p.desc || '',
    openTime: p.open || '00:00',
    closeTime: p.close || '23:59',
    price: p.price || '',
    author: 'carte-initiale',
    createdAt: new Date().toISOString(),
  }));
}

function initDb() {
  // DB_FILE peut pointer hors du dépôt (disque persistant d'un hébergeur) :
  // on crée son dossier, pas seulement data/.
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = { users: {}, points: loadSeed(), itineraries: [], sessions: {} };
  }
  db.users = db.users || {};
  db.points = db.points || [];
  db.itineraries = db.itineraries || [];
  db.sessions = db.sessions || {};
  syncAccounts();
  save();
}

/**
 * Aligne les comptes stockés sur la configuration courante : création des comptes
 * manquants, mise à jour des mots de passe modifiés, suppression de ceux qui ne sont
 * plus listés. Sans cela, changer ACCOUNTS après le premier démarrage laisserait les
 * anciens mots de passe utilisables.
 */
function syncAccounts() {
  for (const [name, password] of Object.entries(ACCOUNTS)) {
    const existing = db.users[name];
    if (!existing || !checkPassword(password, existing.hash)) {
      db.users[name] = { name, hash: hashPassword(password) };
      if (existing) revokeSessions(name);
    }
  }
  for (const name of Object.keys(db.users)) {
    if (!ACCOUNTS[name]) {
      delete db.users[name];
      revokeSessions(name);
    }
  }
}

function revokeSessions(user) {
  for (const [token, session] of Object.entries(db.sessions)) {
    if (session.user === user) delete db.sessions[token];
  }
}

function save() {
  const snapshot = JSON.stringify(db, null, 2);
  const done = writeQueue.then(async () => {
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, snapshot);
    await fsp.rename(tmp, DB_FILE);
  });
  // La file continue même après un échec, mais l'appelant, lui, voit l'erreur
  // et peut répondre 500 au lieu de confirmer une écriture perdue.
  writeQueue = done.catch((err) => console.error('Écriture de la base impossible :', err));
  return done;
}

/* ------------------------------------------------------------------ */
/* Utilitaires HTTP                                                     */
/* ------------------------------------------------------------------ */

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 512 * 1024) {
        reject(new Error('Corps de requête trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 jours

function currentUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const session = db.sessions[token];
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    delete db.sessions[token];
    save();
    return null;
  }
  return session.user;
}

/* ------------------------------------------------------------------ */
/* Validation des points                                                */
/* ------------------------------------------------------------------ */

const CATEGORIES = ['monument', 'musee', 'parc', 'vue', 'quartier', 'food', 'shopping', 'photo', 'sport', 'hotel', 'autre'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanPoint(input, existing = {}) {
  const name = String(input.name ?? existing.name ?? '').trim();
  if (!name) throw new Error('Le nom est obligatoire.');
  if (name.length > 120) throw new Error('Le nom est trop long (120 caractères maximum).');

  const lat = Number(input.lat ?? existing.lat);
  const lng = Number(input.lng ?? existing.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Latitude invalide.');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error('Longitude invalide.');

  const category = String(input.category ?? existing.category ?? 'autre');
  const duration = Math.max(0, Math.min(600, Number(input.duration ?? existing.duration ?? 45) || 0));
  const openTime = String(input.openTime ?? existing.openTime ?? '00:00');
  const closeTime = String(input.closeTime ?? existing.closeTime ?? '23:59');

  return {
    name,
    lat,
    lng,
    category: CATEGORIES.includes(category) ? category : 'autre',
    duration,
    description: String(input.description ?? existing.description ?? '').slice(0, 2000),
    openTime: TIME_RE.test(openTime) ? openTime : '00:00',
    closeTime: TIME_RE.test(closeTime) ? closeTime : '23:59',
    price: String(input.price ?? existing.price ?? '').slice(0, 60),
  };
}

/* ------------------------------------------------------------------ */
/* Routes de l'API                                                      */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  const user = currentUser(req);

  if (pathname === '/api/login' && method === 'POST') {
    const { username, password } = await readBody(req);
    const name = String(username || '').trim().toLowerCase();
    const account = db.users[name];
    if (!account || !checkPassword(String(password || ''), account.hash)) {
      return send(res, 401, { error: 'Identifiant ou mot de passe incorrect.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = { user: name, createdAt: Date.now() };
    await save();
    return send(res, 200, { token, user: name });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token && db.sessions[token]) {
      delete db.sessions[token];
      await save();
    }
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/me' && method === 'GET') {
    if (!user) return send(res, 401, { error: 'Non connecté.' });
    return send(res, 200, { user });
  }

  if (pathname === '/api/points' && method === 'GET') {
    return send(res, 200, { points: db.points });
  }

  if (pathname === '/api/points' && method === 'POST') {
    if (!user) return send(res, 401, { error: 'Connexion requise pour ajouter un point.' });
    let fields;
    try {
      fields = cleanPoint(await readBody(req));
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
    const point = { id: crypto.randomUUID(), ...fields, author: user, createdAt: new Date().toISOString() };
    db.points.push(point);
    await save();
    return send(res, 201, { point });
  }

  const pointMatch = pathname.match(/^\/api\/points\/([\w-]+)$/);
  if (pointMatch) {
    if (!user) return send(res, 401, { error: 'Connexion requise.' });
    const index = db.points.findIndex((p) => p.id === pointMatch[1]);
    if (index === -1) return send(res, 404, { error: 'Point introuvable.' });

    if (method === 'PUT') {
      let fields;
      try {
        fields = cleanPoint(await readBody(req), db.points[index]);
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
      db.points[index] = { ...db.points[index], ...fields, updatedAt: new Date().toISOString(), updatedBy: user };
      await save();
      return send(res, 200, { point: db.points[index] });
    }

    if (method === 'DELETE') {
      const [removed] = db.points.splice(index, 1);
      await save();
      return send(res, 200, { deleted: removed.id });
    }
  }

  if (pathname === '/api/itineraries' && method === 'GET') {
    return send(res, 200, { itineraries: db.itineraries });
  }

  if (pathname === '/api/itineraries' && method === 'POST') {
    if (!user) return send(res, 401, { error: 'Connexion requise.' });
    const body = await readBody(req);
    const title = String(body.title || '').trim().slice(0, 120) || `Journée du ${new Date().toLocaleDateString('fr-FR')}`;
    if (!Array.isArray(body.stops)) return send(res, 400, { error: 'Itinéraire invalide.' });
    const itinerary = {
      id: crypto.randomUUID(),
      title,
      author: user,
      createdAt: new Date().toISOString(),
      startTime: String(body.startTime || '09:00'),
      stops: body.stops.slice(0, 40),
    };
    db.itineraries.unshift(itinerary);
    db.itineraries = db.itineraries.slice(0, 200);
    await save();
    return send(res, 201, { itinerary });
  }

  const itiMatch = pathname.match(/^\/api\/itineraries\/([\w-]+)$/);
  if (itiMatch && method === 'DELETE') {
    if (!user) return send(res, 401, { error: 'Connexion requise.' });
    const index = db.itineraries.findIndex((i) => i.id === itiMatch[1]);
    if (index === -1) return send(res, 404, { error: 'Itinéraire introuvable.' });
    db.itineraries.splice(index, 1);
    await save();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Route inconnue.' });
}

/* ------------------------------------------------------------------ */
/* Fichiers statiques                                                   */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(requested));
  // Empêche toute sortie du dossier public/.
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Interdit.' });
  try {
    const content = await fsp.readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    send(res, 404, { error: 'Page introuvable.' });
  }
}

/* ------------------------------------------------------------------ */

initDb();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: err.message || 'Erreur serveur.' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  🗽 Carte Interactive New York — http://localhost:${PORT}\n`);
  if (process.env.NODE_ENV === 'production') {
    console.log(`  ${Object.keys(ACCOUNTS).length} comptes : ${Object.keys(ACCOUNTS).join(', ')}`);
    console.log(`  Base de données : ${DB_FILE}`);
  } else {
    console.log('  Comptes disponibles :');
    for (const [name, pwd] of Object.entries(ACCOUNTS)) console.log(`    ${name.padEnd(9)} → ${pwd}`);
  }
  console.log('');
});
