// Point d'entrée Cloudflare Workers.
// Les fichiers de public/ sont servis par le binding ASSETS (configuré dans
// wrangler.toml) ; ce Worker ne traite que /api/*.
import { handleApi, errorResponse, parseAccounts, syncAccounts } from '../src/api.js';
import { createD1Store, SCHEMA } from '../src/store-d1.js';
import { seedIfEmpty } from '../src/seed.js';
import seedData from '../data/poi-seed.json';

const DEFAULT_ACCOUNTS = 'axel:axel2026,simon:simon2026,bastien:bastien2026,leo:leo2026';

// L'initialisation (schéma, comptes, lieux d'origine) ne doit se faire qu'une fois
// par instance ; on mémorise la promesse pour ne pas la relancer à chaque requête.
let ready = null;

async function initialise(env, store) {
  for (const statement of SCHEMA.split(';')) {
    const sql = statement.trim();
    if (sql) await env.DB.prepare(sql).run();
  }
  await seedIfEmpty(store, seedData);
  const accounts = parseAccounts(env.ACCOUNTS || DEFAULT_ACCOUNTS);
  if (!Object.keys(accounts).length) {
    throw new Error('ACCOUNTS est défini mais illisible. Format attendu : « axel:motdepasse,simon:autre ».');
  }
  await syncAccounts(store, accounts);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const store = createD1Store(env.DB);
    try {
      // En cas d'échec, on réessaiera à la requête suivante plutôt que de rester cassé.
      ready ??= initialise(env, store).catch((err) => {
        ready = null;
        throw err;
      });
      await ready;
      return await handleApi(request, store, url.pathname);
    } catch (err) {
      return errorResponse(err);
    }
  },
};
