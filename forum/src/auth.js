// Password hashing and session tokens using Web Crypto (available in Workers).

const enc = new TextEncoder();
// workerd caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000;
export const SESSION_MS = 30 * 24 * 3_600_000;
export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60_000;

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomHex(bytes) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// Readable codes for invites and temporary passwords (no 0/O/1/l).
export function randomCode(length = 12) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export async function hashPassword(password, saltHex = randomHex(16)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return { hash: toHex(bits), salt: saltHex };
}

export async function verifyPassword(password, hashHex, saltHex) {
  const { hash } = await hashPassword(password, saltHex);
  if (hash.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export function sessionCookie(token, secure, maxAgeSec = SESSION_MS / 1000) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
