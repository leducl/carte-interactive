// Logique de l'API, indépendante du stockage.
// Deux adaptateurs l'utilisent : un fichier JSON en local (Node), D1 en production
// (Cloudflare). Tout ce qui suit ne connaît que l'interface `store`.
import { hashPassword, verifyPassword, randomToken } from './auth.js';

export const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 jours

const CATEGORIES = ['monument', 'musee', 'parc', 'vue', 'quartier', 'food', 'shopping', 'photo', 'sport', 'hotel', 'autre'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ----------------------------- Comptes ------------------------------ */

export function parseAccounts(raw) {
  const parsed = {};
  for (const entry of String(raw).split(',')) {
    const separator = entry.indexOf(':');
    if (separator < 1) continue;
    const name = entry.slice(0, separator).trim().toLowerCase();
    const password = entry.slice(separator + 1).trim();
    if (name && password) parsed[name] = password;
  }
  return parsed;
}

/**
 * Aligne les comptes stockés sur la configuration courante : création, mise à jour
 * des mots de passe modifiés, suppression de ceux qui ne sont plus listés.
 * Sans cela, changer ACCOUNTS après le premier démarrage laisserait les anciens
 * mots de passe utilisables.
 */
export async function syncAccounts(store, accounts) {
  const existing = await store.listUsers();
  const known = new Map(existing.map((u) => [u.name, u]));

  for (const [name, password] of Object.entries(accounts)) {
    const user = known.get(name);
    if (!user) {
      await store.putUser(name, await hashPassword(password));
    } else if (!(await verifyPassword(password, user.hash))) {
      await store.putUser(name, await hashPassword(password));
      await store.deleteSessionsForUser(name);
    }
  }
  for (const user of existing) {
    if (!accounts[user.name]) {
      await store.deleteUser(user.name);
      await store.deleteSessionsForUser(user.name);
    }
  }
}

/* ---------------------------- Validation ---------------------------- */

export function cleanPoint(input, existing = {}) {
  const name = String(input.name ?? existing.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Le nom est obligatoire.');
  if (name.length > 120) throw new HttpError(400, 'Le nom est trop long (120 caractères maximum).');

  const lat = Number(input.lat ?? existing.lat);
  const lng = Number(input.lng ?? existing.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError(400, 'Latitude invalide.');
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new HttpError(400, 'Longitude invalide.');

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

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------ Routes ------------------------------ */

async function currentUser(store, request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  const session = await store.getSession(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    await store.deleteSession(token);
    return null;
  }
  return session.user;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function body(request) {
  try {
    return (await request.json()) ?? {};
  } catch {
    throw new HttpError(400, 'JSON invalide.');
  }
}

function requireUser(user) {
  if (!user) throw new HttpError(401, 'Connexion requise.');
  return user;
}

/**
 * Traite une requête /api/*. Renvoie une Response, ou null si la route est inconnue
 * (l'appelant sert alors un fichier statique).
 */
export async function handleApi(request, store, pathname) {
  const method = request.method;
  const user = await currentUser(store, request);

  if (pathname === '/api/login' && method === 'POST') {
    const { username, password } = await body(request);
    const name = String(username || '').trim().toLowerCase();
    const account = await store.getUser(name);
    if (!account || !(await verifyPassword(String(password || ''), account.hash))) {
      return json({ error: 'Identifiant ou mot de passe incorrect.' }, 401);
    }
    const token = randomToken();
    await store.putSession(token, name, Date.now());
    return json({ token, user: name });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const header = request.headers.get('authorization') || '';
    if (header.startsWith('Bearer ')) await store.deleteSession(header.slice(7));
    return json({ ok: true });
  }

  if (pathname === '/api/me' && method === 'GET') {
    requireUser(user);
    return json({ user });
  }

  if (pathname === '/api/points' && method === 'GET') {
    return json({ points: await store.listPoints() });
  }

  if (pathname === '/api/points' && method === 'POST') {
    requireUser(user);
    const fields = cleanPoint(await body(request));
    const point = {
      id: crypto.randomUUID(),
      ...fields,
      author: user,
      createdAt: new Date().toISOString(),
    };
    await store.putPoint(point);
    return json({ point }, 201);
  }

  const pointMatch = pathname.match(/^\/api\/points\/([\w-]+)$/);
  if (pointMatch && (method === 'PUT' || method === 'DELETE')) {
    requireUser(user);
    const existing = await store.getPoint(pointMatch[1]);
    if (!existing) return json({ error: 'Point introuvable.' }, 404);

    if (method === 'PUT') {
      const fields = cleanPoint(await body(request), existing);
      const updated = { ...existing, ...fields, updatedAt: new Date().toISOString(), updatedBy: user };
      await store.putPoint(updated);
      return json({ point: updated });
    }
    await store.deletePoint(existing.id);
    return json({ deleted: existing.id });
  }

  if (pathname === '/api/itineraries' && method === 'GET') {
    return json({ itineraries: await store.listItineraries() });
  }

  if (pathname === '/api/itineraries' && method === 'POST') {
    requireUser(user);
    const payload = await body(request);
    if (!Array.isArray(payload.stops)) throw new HttpError(400, 'Itinéraire invalide.');
    const itinerary = {
      id: crypto.randomUUID(),
      title: String(payload.title || '').trim().slice(0, 120) || `Journée du ${new Date().toLocaleDateString('fr-FR')}`,
      author: user,
      createdAt: new Date().toISOString(),
      startTime: String(payload.startTime || '09:00'),
      stops: payload.stops.slice(0, 40),
    };
    await store.putItinerary(itinerary);
    return json({ itinerary }, 201);
  }

  const itineraryMatch = pathname.match(/^\/api\/itineraries\/([\w-]+)$/);
  if (itineraryMatch && method === 'DELETE') {
    requireUser(user);
    const removed = await store.deleteItinerary(itineraryMatch[1]);
    if (!removed) return json({ error: 'Itinéraire introuvable.' }, 404);
    return json({ ok: true });
  }

  return json({ error: 'Route inconnue.' }, 404);
}

export function errorResponse(err) {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  return json({ error: err.message || 'Erreur serveur.' }, status);
}
