// Tests de l'API, exécutables contre n'importe quelle implémentation.
//   BASE_URL=http://localhost:3000 node test/run.js
// Sert à vérifier que le serveur local (fichier JSON) et le Worker (D1)
// se comportent exactement pareil.
const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ACCOUNT = process.env.TEST_USER || 'axel';
const PASSWORD = process.env.TEST_PASSWORD || 'axel2026';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* réponse non JSON */ }
  return { status: res.status, data, text };
}

console.log(`\nTests contre ${BASE}\n`);

console.log('Authentification');
{
  const bad = await call('POST', '/api/login', { body: { username: ACCOUNT, password: 'mauvais' } });
  check('mot de passe incorrect rejeté', bad.status === 401, `reçu ${bad.status}`);

  const unknown = await call('POST', '/api/login', { body: { username: 'inconnu', password: 'x' } });
  check('compte inexistant rejeté', unknown.status === 401);

  const empty = await call('POST', '/api/login', { body: {} });
  check('identifiants vides rejetés', empty.status === 401);
}

const login = await call('POST', '/api/login', { body: { username: ACCOUNT.toUpperCase(), password: PASSWORD } });
check('connexion acceptée (identifiant insensible à la casse)', login.status === 200 && !!login.data?.token,
  `${login.status} ${login.text.slice(0, 80)}`);
const token = login.data?.token;

{
  const me = await call('GET', '/api/me', { token });
  check('/api/me renvoie l\'utilisateur', me.data?.user === ACCOUNT.toLowerCase());
  const anon = await call('GET', '/api/me');
  check('/api/me sans jeton rejeté', anon.status === 401);
  const forged = await call('GET', '/api/me', { token: 'jeton-inventé' });
  check('jeton invalide rejeté', forged.status === 401);
}

console.log('\nLecture des lieux');
const initial = await call('GET', '/api/points');
check('liste accessible sans connexion', initial.status === 200 && Array.isArray(initial.data?.points));
check('les 47 lieux d\'origine sont présents', initial.data.points.length >= 47,
  `${initial.data?.points?.length} trouvés`);
check('un lieu connu est présent', initial.data.points.some((p) => p.name === 'Times Square'));

console.log('\nÉcriture (connexion requise)');
{
  const anon = await call('POST', '/api/points', { body: { name: 'X', lat: 40, lng: -73 } });
  check('ajout sans connexion rejeté', anon.status === 401);
}

console.log('\nValidation');
for (const [label, body] of [
  ['nom vide refusé', { name: '  ', lat: 40, lng: -73 }],
  ['latitude hors limites refusée', { name: 'X', lat: 999, lng: -73 }],
  ['longitude hors limites refusée', { name: 'X', lat: 40, lng: 999 }],
  ['latitude non numérique refusée', { name: 'X', lat: 'abc', lng: -73 }],
]) {
  const res = await call('POST', '/api/points', { token, body });
  check(label, res.status === 400, `reçu ${res.status}`);
}

let createdId = null;
{
  const res = await call('POST', '/api/points', {
    token,
    body: { name: 'Lieu de test', lat: 40.7, lng: -74, category: 'hotel', duration: 30, openTime: '08:00', closeTime: '20:00', price: 'gratuit', description: 'note' },
  });
  createdId = res.data?.point?.id;
  check('ajout accepté', res.status === 201 && !!createdId, `${res.status} ${res.text.slice(0, 80)}`);
  check('auteur enregistré', res.data?.point?.author === ACCOUNT.toLowerCase());

  const bogus = await call('POST', '/api/points', { token, body: { name: 'Y', lat: 40, lng: -73, category: 'licorne', duration: 9999 } });
  check('catégorie inconnue ramenée à « autre »', bogus.data?.point?.category === 'autre');
  check('durée plafonnée à 600 min', bogus.data?.point?.duration === 600);
  const bogusTime = await call('POST', '/api/points', { token, body: { name: 'Z', lat: 40, lng: -73, openTime: '99:99' } });
  check('horaire invalide ramené à 00:00', bogusTime.data?.point?.openTime === '00:00');
  for (const id of [bogus.data?.point?.id, bogusTime.data?.point?.id]) {
    if (id) await call('DELETE', `/api/points/${id}`, { token });
  }
}

{
  const listed = await call('GET', '/api/points');
  check('le lieu ajouté apparaît pour tout le monde', listed.data.points.some((p) => p.id === createdId));

  const updated = await call('PUT', `/api/points/${createdId}`, { token, body: { name: 'Lieu renommé' } });
  check('modification acceptée', updated.data?.point?.name === 'Lieu renommé');
  check('champs non transmis conservés', updated.data?.point?.duration === 30 && updated.data?.point?.price === 'gratuit');
  check('trace de la modification', updated.data?.point?.updatedBy === ACCOUNT.toLowerCase());

  const missing = await call('PUT', '/api/points/inexistant', { token, body: { name: 'X' } });
  check('modification d\'un lieu inexistant → 404', missing.status === 404);
}

console.log('\nItinéraires');
let itineraryId = null;
{
  const bad = await call('POST', '/api/itineraries', { token, body: { title: 'X' } });
  check('itinéraire sans étapes refusé', bad.status === 400);

  const saved = await call('POST', '/api/itineraries', {
    token,
    body: { title: 'Journée de test', startTime: '10:00', stops: [{ id: createdId, name: 'Lieu de test', lat: 40.7, lng: -74 }] },
  });
  itineraryId = saved.data?.itinerary?.id;
  check('itinéraire enregistré', saved.status === 201 && !!itineraryId);

  const listed = await call('GET', '/api/itineraries');
  check('itinéraire visible par le groupe', listed.data.itineraries.some((i) => i.id === itineraryId));

  const anon = await call('POST', '/api/itineraries', { body: { stops: [] } });
  check('enregistrement sans connexion rejeté', anon.status === 401);

  const removed = await call('DELETE', `/api/itineraries/${itineraryId}`, { token });
  check('suppression acceptée', removed.status === 200);
  const again = await call('DELETE', `/api/itineraries/${itineraryId}`, { token });
  check('seconde suppression → 404', again.status === 404);
}

console.log('\nSuppression et déconnexion');
{
  const anon = await call('DELETE', `/api/points/${createdId}`);
  check('suppression sans connexion rejetée', anon.status === 401);

  const removed = await call('DELETE', `/api/points/${createdId}`, { token });
  check('suppression acceptée', removed.status === 200);

  const listed = await call('GET', '/api/points');
  check('le lieu a bien disparu', !listed.data.points.some((p) => p.id === createdId));
  check('les lieux d\'origine sont intacts', listed.data.points.length >= 47);

  await call('POST', '/api/logout', { token });
  const after = await call('GET', '/api/me', { token });
  check('jeton invalidé après déconnexion', after.status === 401);
}

console.log('\nDivers');
{
  const unknown = await call('GET', '/api/nimporte-quoi');
  check('route inconnue → 404', unknown.status === 404);
  const home = await fetch(`${BASE}/`);
  check('page d\'accueil servie', home.status === 200 && (await home.text()).includes('Carte Interactive'));
  const asset = await fetch(`${BASE}/js/planner.js`);
  check('fichiers JS servis', asset.status === 200);
}

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed ? 1 : 0);
