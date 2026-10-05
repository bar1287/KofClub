// Creates .env from .env.example on first run and fills in locally generated
// secrets. Safe to run repeatedly: existing non-empty values are preserved.
// Plain Node (18+), so it runs everywhere: scripts/init-env.sh calls it with
// a local Node or inside the node image, and demo.cmd (Windows) inside Docker.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
// Windows checkouts may carry CRLF line endings; .env is always written with LF.
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

if (!existsSync(envPath)) {
  writeFileSync(envPath, read(join(root, '.env.example')));
  console.log('init-env: created .env from .env.example');
}
const lines = read(envPath).split('\n');
if (lines.at(-1) !== '') lines.push('');

const index = (key) => lines.findIndex((l) => l.startsWith(`${key}=`));

/** Sets key when it is missing or empty; with force, always. */
function set(key, value, force = false) {
  const i = index(key);
  if (i < 0) {
    lines.splice(lines.length - 1, 0, `${key}=${value}`); // keep the final newline
  } else if (force || lines[i] === `${key}=`) {
    lines[i] = `${key}=${value}`;
  } else {
    return;
  }
  console.log(`init-env: generated ${key}`);
}

const isEmpty = (key) => {
  const i = index(key);
  return i < 0 || lines[i] === `${key}=`;
};

// Ed25519 key pair for access tokens (both halves are replaced together).
if (isEmpty('AUTH_JWT_PRIVATE_KEY_B64')) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const b64 = (pem) => Buffer.from(pem).toString('base64');
  set('AUTH_JWT_PRIVATE_KEY_B64', b64(privateKey.export({ type: 'pkcs8', format: 'pem' })));
  set('AUTH_JWT_PUBLIC_KEY_B64', b64(publicKey.export({ type: 'spki', format: 'pem' })), true);
}
set('INTERNAL_SERVICE_TOKEN', randomBytes(32).toString('hex'));
set('IP_HASH_SECRET', randomBytes(32).toString('hex'));
set('MFA_ENCRYPTION_KEY_B64', randomBytes(32).toString('base64'));
set('DECK_ENCRYPTION_KEY_B64', randomBytes(32).toString('base64'));

writeFileSync(envPath, lines.join('\n'));
