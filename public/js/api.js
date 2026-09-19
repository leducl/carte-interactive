// Accès aux données.
// Deux modes : « serveur » (Node, points réellement partagés entre tout le monde)
// et « local » (repli automatique quand le site est servi en statique, ex. GitHub Pages).
const LS = { token: 'nyc.token', user: 'nyc.user', points: 'nyc.points', itineraries: 'nyc.itineraries' };

// Mots de passe du mode local (le mode serveur les vérifie côté Node, hachés).
const LOCAL_ACCOUNTS = { axel: 'axel2026', simon: 'simon2026', bastien: 'bastien2026', leo: 'leo2026' };

export const state = { mode: 'server', user: null, token: null };

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('Réponse serveur invalide'); }
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

/* --------------------------- mode local ---------------------------- */

function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function writeLocal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / mode privé */ }
}

async function seedLocalPoints() {
  const existing = readLocal(LS.points, null);
  if (existing && existing.length) return existing;
  const res = await fetch('poi-seed.json');
  const seed = await res.json();
  const points = seed.map((p) => ({
    id: uid(), name: p.name, lat: p.lat, lng: p.lng, category: p.cat,
    duration: p.dur, description: p.desc || '', openTime: p.open || '00:00',
    closeTime: p.close || '23:59', price: p.price || '', author: 'carte-initiale',
    createdAt: new Date().toISOString(),
  }));
  writeLocal(LS.points, points);
  return points;
}

/* ------------------------------------------------------------------ */

/** Détecte si un backend Node répond ; sinon bascule en mode local. */
export async function detectMode() {
  try {
    const res = await fetch('api/points', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('indisponible');
    await res.json();
    state.mode = 'server';
  } catch {
    state.mode = 'local';
  }
  state.token = localStorage.getItem(LS.token);
  state.user = localStorage.getItem(LS.user);
  if (state.mode === 'server' && state.token) {
    try { await request('api/me'); } catch { logout(); }
  }
  return state.mode;
}

export async function login(username, password) {
  const name = String(username || '').trim().toLowerCase();
  if (state.mode === 'local') {
    if (LOCAL_ACCOUNTS[name] !== password) throw new Error('Identifiant ou mot de passe incorrect.');
    state.user = name;
    state.token = `local-${name}`;
  } else {
    const data = await request('api/login', { method: 'POST', body: JSON.stringify({ username: name, password }) });
    state.user = data.user;
    state.token = data.token;
  }
  localStorage.setItem(LS.token, state.token);
  localStorage.setItem(LS.user, state.user);
  return state.user;
}

export function logout() {
  if (state.mode === 'server' && state.token) {
    request('api/logout', { method: 'POST' }).catch(() => {});
  }
  state.user = null;
  state.token = null;
  localStorage.removeItem(LS.token);
  localStorage.removeItem(LS.user);
}

export async function getPoints() {
  if (state.mode === 'local') return seedLocalPoints();
  const { points } = await request('api/points');
  return points;
}

export async function addPoint(fields) {
  if (!state.user) throw new Error('Connectez-vous pour ajouter un point.');
  if (state.mode === 'local') {
    const points = await seedLocalPoints();
    const point = { id: uid(), ...fields, author: state.user, createdAt: new Date().toISOString() };
    points.push(point);
    writeLocal(LS.points, points);
    return point;
  }
  const { point } = await request('api/points', { method: 'POST', body: JSON.stringify(fields) });
  return point;
}

export async function updatePoint(id, fields) {
  if (!state.user) throw new Error('Connectez-vous pour modifier un point.');
  if (state.mode === 'local') {
    const points = await seedLocalPoints();
    const index = points.findIndex((p) => p.id === id);
    if (index === -1) throw new Error('Point introuvable.');
    points[index] = { ...points[index], ...fields, updatedBy: state.user, updatedAt: new Date().toISOString() };
    writeLocal(LS.points, points);
    return points[index];
  }
  const { point } = await request(`api/points/${id}`, { method: 'PUT', body: JSON.stringify(fields) });
  return point;
}

export async function deletePoint(id) {
  if (!state.user) throw new Error('Connectez-vous pour supprimer un point.');
  if (state.mode === 'local') {
    const points = (await seedLocalPoints()).filter((p) => p.id !== id);
    writeLocal(LS.points, points);
    return;
  }
  await request(`api/points/${id}`, { method: 'DELETE' });
}

export async function getItineraries() {
  if (state.mode === 'local') return readLocal(LS.itineraries, []);
  const { itineraries } = await request('api/itineraries');
  return itineraries;
}

export async function saveItinerary(itinerary) {
  if (!state.user) throw new Error('Connectez-vous pour enregistrer un itinéraire.');
  if (state.mode === 'local') {
    const all = readLocal(LS.itineraries, []);
    const saved = { id: uid(), author: state.user, createdAt: new Date().toISOString(), ...itinerary };
    all.unshift(saved);
    writeLocal(LS.itineraries, all.slice(0, 50));
    return saved;
  }
  const { itinerary: saved } = await request('api/itineraries', { method: 'POST', body: JSON.stringify(itinerary) });
  return saved;
}

export async function deleteItinerary(id) {
  if (state.mode === 'local') {
    writeLocal(LS.itineraries, readLocal(LS.itineraries, []).filter((i) => i.id !== id));
    return;
  }
  await request(`api/itineraries/${id}`, { method: 'DELETE' });
}
