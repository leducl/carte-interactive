// Serveur de développement local (`npm start`).
// Il partage toute sa logique avec le Worker Cloudflare (src/api.js) ; seul le
// stockage diffère : un fichier JSON ici, D1 en production.
// Zéro dépendance : uniquement la bibliothèque standard de Node.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleApi, errorResponse, parseAccounts, syncAccounts } from './src/api.js';
import { createJsonStore } from './src/store-json.js';
import { seedIfEmpty } from './src/seed.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'db.json');
const DEFAULT_ACCOUNTS = 'axel:axel2026,simon:simon2026,bastien:bastien2026,leo:leo2026';

const seedData = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'poi-seed.json'), 'utf8'));
const accounts = parseAccounts(process.env.ACCOUNTS || DEFAULT_ACCOUNTS);
if (!Object.keys(accounts).length) {
  console.error('ACCOUNTS est défini mais illisible. Format attendu : « axel:motdepasse,simon:autre ».');
  process.exit(1);
}

const store = createJsonStore(DB_FILE);
await seedIfEmpty(store, seedData);
await syncAccounts(store, accounts);

/* ------------------------- Fichiers statiques ------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(requested));
  // Empêche toute sortie du dossier public/.
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return new Response(JSON.stringify({ error: 'Interdit.' }), { status: 403 });
  }
  try {
    const content = await fsp.readFile(filePath);
    return new Response(content, {
      headers: { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Page introuvable.' }), { status: 404 });
  }
}

/* ------------- Passerelle entre node:http et l'API fetch ------------- */

function toFetchRequest(req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers: new Headers(req.headers),
    body: hasBody ? req : undefined,
    duplex: hasBody ? 'half' : undefined,
  });
}

async function writeResponse(response, res) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer(async (req, res) => {
  try {
    const request = toFetchRequest(req);
    const { pathname } = new URL(request.url);
    const response = pathname.startsWith('/api/')
      ? await handleApi(request, store, pathname)
      : await serveStatic(pathname);
    await writeResponse(response, res);
  } catch (err) {
    await writeResponse(errorResponse(err), res).catch(() => res.end());
  }
});

server.listen(PORT, () => {
  console.log(`\n  🗽 Carte Interactive New York — http://localhost:${PORT}\n`);
  if (process.env.ACCOUNTS) {
    console.log(`  ${Object.keys(accounts).length} comptes : ${Object.keys(accounts).join(', ')}`);
  } else {
    console.log('  Comptes disponibles :');
    for (const [name, pwd] of Object.entries(accounts)) console.log(`    ${name.padEnd(9)} → ${pwd}`);
  }
  console.log(`  Base de données : ${DB_FILE}\n`);
});
