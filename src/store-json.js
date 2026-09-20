// Stockage dans un fichier JSON, pour le développement local (`npm start`).
// Écriture atomique et sérialisée ; chaque écriture est attendue avant la réponse.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function createJsonStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let db = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : { users: {}, points: [], itineraries: [], sessions: {} };
  db.users ||= {};
  db.points ||= [];
  db.itineraries ||= [];
  db.sessions ||= {};

  let queue = Promise.resolve();
  function save() {
    const snapshot = JSON.stringify(db, null, 2);
    const done = queue.then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, snapshot);
      await fsp.rename(tmp, file);
    });
    // La file continue après un échec, mais l'appelant voit l'erreur et peut
    // répondre 500 plutôt que de confirmer une écriture perdue.
    queue = done.catch((err) => console.error('Écriture de la base impossible :', err));
    return done;
  }

  return {
    async countPoints() { return db.points.length; },
    async seedPoints(points) { db.points = points; await save(); },

    async listUsers() { return Object.values(db.users); },
    async getUser(name) { return db.users[name] || null; },
    async putUser(name, hash) { db.users[name] = { name, hash }; await save(); },
    async deleteUser(name) { delete db.users[name]; await save(); },

    async getSession(token) { return db.sessions[token] || null; },
    async putSession(token, user, createdAt) { db.sessions[token] = { user, createdAt }; await save(); },
    async deleteSession(token) { delete db.sessions[token]; await save(); },
    async deleteSessionsForUser(user) {
      for (const [token, session] of Object.entries(db.sessions)) {
        if (session.user === user) delete db.sessions[token];
      }
      await save();
    },

    async listPoints() { return db.points; },
    async getPoint(id) { return db.points.find((p) => p.id === id) || null; },
    async putPoint(point) {
      const index = db.points.findIndex((p) => p.id === point.id);
      if (index === -1) db.points.push(point);
      else db.points[index] = point;
      await save();
    },
    async deletePoint(id) {
      db.points = db.points.filter((p) => p.id !== id);
      await save();
    },

    async listItineraries() { return db.itineraries; },
    async putItinerary(itinerary) {
      db.itineraries.unshift(itinerary);
      db.itineraries = db.itineraries.slice(0, 200);
      await save();
    },
    async deleteItinerary(id) {
      const before = db.itineraries.length;
      db.itineraries = db.itineraries.filter((i) => i.id !== id);
      if (db.itineraries.length === before) return false;
      await save();
      return true;
    },
  };
}
