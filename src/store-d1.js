// Stockage dans Cloudflare D1 (SQLite géré), pour la production.
// Les points et itinéraires gardent leurs champs libres dans une colonne JSON :
// le schéma reste stable même si on ajoute un champ à un lieu.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  name TEXT PRIMARY KEY,
  hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user);
CREATE TABLE IF NOT EXISTS points (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS itineraries (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function createD1Store(db) {
  return {
    async countPoints() {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM points').first();
      return row?.n ?? 0;
    },
    async seedPoints(points) {
      if (!points.length) return;
      const insert = db.prepare('INSERT OR REPLACE INTO points (id, data, created_at) VALUES (?, ?, ?)');
      await db.batch(points.map((p) => insert.bind(p.id, JSON.stringify(p), p.createdAt)));
    },

    async listUsers() {
      const { results } = await db.prepare('SELECT name, hash FROM users').all();
      return results;
    },
    async getUser(name) {
      return (await db.prepare('SELECT name, hash FROM users WHERE name = ?').bind(name).first()) || null;
    },
    async putUser(name, hash) {
      await db.prepare('INSERT OR REPLACE INTO users (name, hash) VALUES (?, ?)').bind(name, hash).run();
    },
    async deleteUser(name) {
      await db.prepare('DELETE FROM users WHERE name = ?').bind(name).run();
    },

    async getSession(token) {
      const row = await db.prepare('SELECT user, created_at FROM sessions WHERE token = ?').bind(token).first();
      return row ? { user: row.user, createdAt: row.created_at } : null;
    },
    async putSession(token, user, createdAt) {
      await db.prepare('INSERT OR REPLACE INTO sessions (token, user, created_at) VALUES (?, ?, ?)')
        .bind(token, user, createdAt).run();
    },
    async deleteSession(token) {
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    },
    async deleteSessionsForUser(user) {
      await db.prepare('DELETE FROM sessions WHERE user = ?').bind(user).run();
    },

    async listPoints() {
      const { results } = await db.prepare('SELECT data FROM points ORDER BY created_at').all();
      return results.map((r) => JSON.parse(r.data));
    },
    async getPoint(id) {
      const row = await db.prepare('SELECT data FROM points WHERE id = ?').bind(id).first();
      return row ? JSON.parse(row.data) : null;
    },
    async putPoint(point) {
      await db.prepare('INSERT OR REPLACE INTO points (id, data, created_at) VALUES (?, ?, ?)')
        .bind(point.id, JSON.stringify(point), point.createdAt).run();
    },
    async deletePoint(id) {
      await db.prepare('DELETE FROM points WHERE id = ?').bind(id).run();
    },

    async listItineraries() {
      const { results } = await db.prepare('SELECT data FROM itineraries ORDER BY created_at DESC LIMIT 200').all();
      return results.map((r) => JSON.parse(r.data));
    },
    async putItinerary(itinerary) {
      await db.prepare('INSERT OR REPLACE INTO itineraries (id, data, created_at) VALUES (?, ?, ?)')
        .bind(itinerary.id, JSON.stringify(itinerary), itinerary.createdAt).run();
    },
    async deleteItinerary(id) {
      const result = await db.prepare('DELETE FROM itineraries WHERE id = ?').bind(id).run();
      return (result.meta?.changes ?? 0) > 0;
    },
  };
}
