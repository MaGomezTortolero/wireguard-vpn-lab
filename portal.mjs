import { createServer } from 'node:http';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { umask } from 'node:process';
import { readFileSync } from 'node:fs';

umask(0o077);
const { ADMIN_EMAIL, ADMIN_PASSWORD, VPN_INTERFACE, VPN_ENDPOINT, VPN_PUBLIC_KEY } = process.env;
const live = Boolean(VPN_INTERFACE);
const keyPattern = /^[A-Za-z0-9+/]{43}=$/;
if (live && (!/^[\w.-]{1,15}$/.test(VPN_INTERFACE) ||
    !/^[a-zA-Z0-9.-]+:[0-9]{1,5}$/.test(VPN_ENDPOINT ?? '') ||
    !keyPattern.test(VPN_PUBLIC_KEY ?? ''))) {
  throw new Error('Configura VPN_INTERFACE, VPN_ENDPOINT y VPN_PUBLIC_KEY.');
}
const db = new DatabaseSync(process.env.PORTAL_DB ?? 'portal.sqlite');
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, secret TEXT NOT NULL, role TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS devices (
    slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 2 AND 254),
    owner INTEGER NOT NULL REFERENCES users(id), label TEXT NOT NULL, public_key TEXT UNIQUE NOT NULL,
    mode TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS demo_peers (public_key TEXT PRIMARY KEY);
`);
const emailFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function addUser(email, password, role) {
  if (!emailFormat.test(email) || email.length > 254 || password.length < 12 || password.length > 256) {
    throw new Error('Usa un correo válido y una contraseña de 12 a 256 caracteres.');
  }
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  db.prepare('INSERT INTO users (email, secret, role) VALUES (?, ?, ?)').run(email, salt + ':' + hash, role);
}
if (!db.prepare("SELECT id FROM users WHERE role = 'admin'").get()) {
  addUser(ADMIN_EMAIL?.trim().toLowerCase() ?? '', ADMIN_PASSWORD ?? '', 'admin');
}

const sessions = new Map();
const attempts = new Map();
const digest = value => createHash('sha256').update(value).digest('hex');
const runWG = (...args) => execFileSync('wg', args, { encoding: 'utf8', timeout: 5000 });
function peers() {
  if (!live) return new Map(db.prepare('SELECT public_key FROM demo_peers').all().map(row => [row.public_key, 0]));
  return new Map(runWG('show', VPN_INTERFACE, 'latest-handshakes').trim().split('\n').filter(Boolean)
    .map(line => { const [key, time] = line.split('\t'); return [key, Number(time)]; }));
}
function setAccess(device, enabled) {
  if (live) {
    const change = enabled ? ['allowed-ips', `10.77.0.${device.slot}/32`] : ['remove'];
    runWG('set', VPN_INTERFACE, 'peer', device.public_key, ...change);
  } else if (enabled) {
    db.prepare('INSERT OR IGNORE INTO demo_peers VALUES (?)').run(device.public_key);
  } else {
    db.prepare('DELETE FROM demo_peers WHERE public_key = ?').run(device.public_key);
  }
}

const ui = readFileSync(new URL('./portal.html', import.meta.url));
const js = readFileSync(new URL('./portal-ui.js', import.meta.url));
const error = (status, message) => Object.assign(new Error(message), { status });
const secure = process.env.HTTPS_PROXY_DEPLOYMENT === '1' ? '; Secure' : '';
const cookie = (value, age) => `portal=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
function reply(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let payload = '';
  for await (const part of req) {
    payload += part.toString();
    if (payload.length > 8192) throw error(413, 'Solicitud demasiado grande.');
  }
  try { return JSON.parse(payload); } catch { throw error(400, 'JSON inválido.'); }
}
const string = value => typeof value === 'string' ? value : '';

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  try {
    if (req.method === 'GET' && ['/', '/ui.js'].includes(req.url)) {
      const home = req.url === '/';
      res.writeHead(200, { 'Content-Type': home ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
      return res.end(home ? ui : js);
    }
    if (req.method === 'POST' && req.headers['content-type'] !== 'application/json') {
      throw error(415, 'Se requiere JSON.');
    }
    const token = req.headers.cookie?.match(/(?:^|; )portal=([a-f0-9]{64})(?:;|$)/)?.[1];
    const session = token ? sessions.get(digest(token)) : undefined;
    const user = session?.expires > Date.now() ? session.user : undefined;

    if (req.method === 'POST' && req.url === '/api/login') {
      const ip = req.socket.remoteAddress;
      const attempt = attempts.get(ip) ?? { count: 0, expires: Date.now() + 60_000 };
      if (attempt.count >= 8) throw error(429, 'Demasiados intentos. Espera un minuto.');
      attempt.count++;
      attempts.set(ip, attempt);
      const input = await body(req);
      const email = string(input?.email).trim().toLowerCase();
      const password = string(input?.password);
      const account = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const [salt, expected] = (account?.secret ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
      const match = password.length <= 256 && timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(expected, 'hex'));
      if (!account || !match) throw error(401, 'Correo o contraseña incorrectos.');
      attempts.delete(ip);
      if (token) sessions.delete(digest(token));
      const fresh = randomBytes(32).toString('hex');
      sessions.set(digest(fresh), { user: { id: account.id, email, role: account.role }, expires: Date.now() + 8 * 3600_000 });
      res.setHeader('Set-Cookie', cookie(fresh, 28800));
      return reply(res, 200, { ok: true });
    }
    if (!user) throw error(401, 'Inicia sesión.');
    if (req.method === 'POST' && req.url === '/api/logout') {
      sessions.delete(digest(token));
      res.setHeader('Set-Cookie', cookie('', 0));
      return reply(res, 200, { ok: true });
    }

    const admin = user.role === 'admin';
    if (req.method === 'GET' && req.url === '/api/state') {
      const current = peers();
      const devices = (admin ? db.prepare('SELECT * FROM devices').all() :
        db.prepare('SELECT * FROM devices WHERE owner = ?').all(user.id)).map(device => ({
        ...device, active: current.has(device.public_key), handshake: current.get(device.public_key) ?? 0
      }));
      const users = admin ? db.prepare('SELECT id, email, role FROM users ORDER BY email').all() : [];
      return reply(res, 200, { user, devices, users, live, endpoint: VPN_ENDPOINT, serverKey: VPN_PUBLIC_KEY });
    }
    if (!admin) throw error(403, 'Se requiere rol de administrador.');
    if (req.method !== 'POST') throw error(404, 'Ruta desconocida.');
    const input = await body(req);
    if (req.url === '/api/users') {
      const email = string(input?.email).trim().toLowerCase();
      if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw error(409, 'El correo ya existe.');
      try { addUser(email, string(input?.password), 'member'); }
      catch (problem) { throw error(400, problem.message); }
    } else if (req.url === '/api/devices') {
      const label = string(input?.label).trim(), key = string(input?.publicKey).trim();
      if (!label || label.length > 80 || !keyPattern.test(key) || Buffer.from(key, 'base64').toString('base64') !== key ||
          key === VPN_PUBLIC_KEY || !['private', 'full'].includes(input?.mode) ||
          !Number.isInteger(input?.owner) || !db.prepare('SELECT id FROM users WHERE id = ?').get(input.owner)) {
        throw error(400, 'Revisa el nombre, titular, modo y clave pública de WireGuard.');
      }
      if (db.prepare('SELECT slot FROM devices WHERE public_key = ?').get(key) || peers().has(key)) {
        throw error(409, 'La clave pública ya está registrada.');
      }
      const taken = new Set(db.prepare('SELECT slot FROM devices').all().map(row => row.slot));
      const slot = Array.from({ length: 253 }, (_, index) => index + 2).find(value => !taken.has(value));
      if (!slot) throw error(409, 'La subred del portal está llena.');
      db.prepare('INSERT INTO devices VALUES (?, ?, ?, ?, ?)').run(slot, input.owner, label, key, input.mode);
    } else if (req.url === '/api/access') {
      if (!Number.isInteger(input?.slot) || typeof input?.enabled !== 'boolean') throw error(400, 'Solicitud inválida.');
      const device = db.prepare('SELECT * FROM devices WHERE slot = ?').get(input.slot);
      if (!device) throw error(404, 'Puesto desconocido.');
      setAccess(device, input.enabled);
    } else {
      throw error(404, 'Ruta desconocida.');
    }
    return reply(res, 200, { ok: true });
  } catch (problem) {
    if (!problem.status) console.error(problem.message);
    reply(res, problem.status ?? 500, { error: problem.status ? problem.message : 'El servidor no pudo completar la operación.' });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const map of [sessions, attempts]) for (const [key, item] of map) if (item.expires <= now) map.delete(key);
}, 30_000).unref();
server.listen(Number(process.env.PORT ?? 8787), '127.0.0.1', () => {
  console.log(`Portal en http://127.0.0.1:${server.address().port} · ${live ? 'WireGuard' : 'demostración'}`);
});
