// Hachage des mots de passe via WebCrypto (PBKDF2-SHA256).
// Disponible à l'identique dans Node ≥ 18 et dans les Workers Cloudflare,
// contrairement à scrypt qui n'existe que côté Node.
//
// 10 000 itérations : volontairement modeste, car les Workers du plan gratuit
// sont limités en temps CPU par requête. C'est suffisant ici (4 comptes privés,
// pas de données sensibles), et la connexion est rare puisque le jeton de session
// est valable 30 jours.
const ITERATIONS = 10000;
const KEY_LENGTH = 32;

const encoder = new TextEncoder();

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
    key,
    KEY_LENGTH * 8,
  );
  return toHex(bits);
}

export async function hashPassword(password) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${salt}$${hash}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iterations, salt, expected] = String(stored).split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !expected) return false;
  const actual = await derive(password, salt, Number(iterations));
  // Comparaison à temps constant.
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function randomToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(24)));
}
