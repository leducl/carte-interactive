// Charge les 47 lieux d'origine dans une base vide.
export function buildSeedPoints(seed) {
  const now = new Date().toISOString();
  return seed.map((p, index) => ({
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
    // Index dans l'horodatage pour que l'ordre d'affichage reste celui du fichier.
    createdAt: new Date(Date.parse(now) + index).toISOString(),
  }));
}

/** Ne sème que si la base est vide : sans effet aux démarrages suivants. */
export async function seedIfEmpty(store, seed) {
  if ((await store.countPoints()) > 0) return false;
  await store.seedPoints(buildSeedPoints(seed));
  return true;
}
