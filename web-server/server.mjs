// Runtime for the website built by web/docker-compose.yml. No npm dependencies.
import { createServer } from 'node:http';
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';

let password = process.env.DOX_WEB_PASSWORD;
if (!password?.trim()) throw new Error('Set a nonblank DOX_WEB_PASSWORD before starting the website');
const salt = randomBytes(16);
const scryptOptions = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const verifier = scryptSync(password, salt, 32, scryptOptions);
password = undefined;
delete process.env.DOX_WEB_PASSWORD;
const derive = promisify(scrypt);
const publicRoot = await realpath(fileURLToPath(new URL('../public/', import.meta.url)));
const secure = process.env.DOX_COOKIE_SECURE !== 'false';
const cookieName = secure ? '__Host-dox_session' : 'dox_session';
const lifetime = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();
let loginChecks = 0;

function prune() {
  const now = Date.now();
  for (const [token, expiry] of sessions) if (expiry <= now) sessions.delete(token);
  for (const [address, entry] of attempts) if (entry.reset <= now) attempts.delete(address);
}
setInterval(prune, 60_000).unref();

function sessionToken(request) {
  return request.headers.cookie?.split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
function authenticated(request) {
  const token = sessionToken(request);
  const expiry = sessions.get(token);
  if (!expiry || expiry <= Date.now()) { sessions.delete(token); return false; }
  return true;
}
function cookie(token, seconds) {
  return `${cookieName}=${token}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}
function respond(response, status, text = '', headers = {}) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  response.end(text);
}
function redirect(response, destination, headers = {}) {
  respond(response, 303, '', { Location: destination, ...headers });
}
function safeReturn(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n\x00]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://dox.invalid');
    if (url.origin !== 'https://dox.invalid' || url.pathname.startsWith('/auth/') || url.pathname === '/login') return '/';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function loginPage(response, returnTo, error = '', status = 200) {
  respond(response, status, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · dox</title><style>
:root{color-scheme:light dark;font:16px system-ui,sans-serif}*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:light-dark(#f7f7f5,#191919)}
main{width:100%;max-width:340px}h1{font-size:24px;font-weight:550;margin:0 0 12px}p{line-height:1.5;opacity:.75}
label{display:block;margin:24px 0 8px}input,button{font:inherit;width:100%;padding:12px;border-radius:8px}
input{border:1px solid #8888;background:transparent}button{margin-top:16px;cursor:pointer;border:0;background:light-dark(#252525,#eee);color:light-dark(#fff,#171717)}
.error{color:light-dark(#a32020,#ff9999);opacity:1}
</style></head><body><main><h1>Library password</h1><p>Enter the shared password to open this library.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/auth/login"><input type="hidden" name="return" value="${escapeHtml(safeReturn(returnTo))}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Open library</button></form>
<script>const field=document.querySelector('[name="return"]');if(!field.value.includes('#'))field.value+=location.hash;</script>
</main></body></html>`, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
}
function sameOrigin(request) {
  // Dokploy terminates TLS and preserves the public Host header. Do not trust
  // forwarded client addresses or arbitrary forwarded protocol headers.
  const origin = `${secure ? 'https' : 'http'}://${request.headers.host}`;
  return request.headers.origin === origin && request.headers['sec-fetch-site'] !== 'cross-site';
}
async function readForm(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error('body-too-large');
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
async function login(request, response) {
  if (!sameOrigin(request)) return respond(response, 403, 'Invalid request origin');
  if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
    return respond(response, 415, 'Expected a form');
  }
  prune();
  // Use the socket address, not a spoofable forwarding header. Behind a proxy
  // this deliberately gives all visitors a shared login budget.
  const address = request.socket.remoteAddress ?? 'unknown';
  let entry = attempts.get(address);
  if (!entry) {
    if (attempts.size >= 1024) return respond(response, 429, 'Too many login attempts', { 'Retry-After': '60' });
    entry = { count: 0, reset: Date.now() + 60_000 };
    attempts.set(address, entry);
  }
  if (++entry.count > 20 || loginChecks >= 2) {
    return respond(response, 429, 'Too many login attempts. Try again shortly.', { 'Retry-After': '60' });
  }
  loginChecks++;
  try {
    let form;
    try { form = await readForm(request); }
    catch { return respond(response, 413, 'Login form is too large'); }
    const candidate = await derive(form.get('password') ?? '', salt, verifier.length, scryptOptions);
    if (!timingSafeEqual(verifier, candidate)) return loginPage(response, form.get('return'), 'Incorrect password. Try again.', 401);
    if (sessions.size >= 4096) return respond(response, 503, 'Too many active sessions. Try again later.');
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, Date.now() + lifetime);
    redirect(response, safeReturn(form.get('return')), { 'Set-Cookie': cookie(token, lifetime / 1000) });
  } finally { loginChecks--; }
}

const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
}));
const inlineAttachments = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.txt']);
async function serveFile(request, response, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { return respond(response, 400, 'Invalid path'); }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part.startsWith('.'))) {
    return respond(response, 404, 'Not found');
  }
  const path = resolve(publicRoot, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!path.startsWith(publicRoot + sep)) return respond(response, 404, 'Not found');
  let handle;
  try {
    const actual = await realpath(path);
    if (!actual.startsWith(publicRoot + sep)) return respond(response, 404, 'Not found');
    handle = await open(actual, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) return respond(response, 404, 'Not found');
    const extension = extname(actual).toLowerCase();
    const attachment = decoded.startsWith('/attachments/');
    const download = attachment && !inlineAttachments.has(extension);
    const headers = {
      'Content-Type': download ? 'application/octet-stream' : types.get(extension) ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
    };
    if (download) headers['Content-Disposition'] = 'attachment';
    if (attachment || decoded.startsWith('/media/')) {
      // Arbitrary attachments and SVG images must not execute as this origin.
      headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
    }
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    if (request.headers.range && request.method === 'GET') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (!match || (!match[1] && !match[2]) || !stat.size) {
        return respond(response, 416, '', { 'Content-Range': `bytes */${stat.size}` });
      }
      if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
      else { start = Math.max(0, stat.size - Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
        return respond(response, 416, '', { 'Content-Range': `bytes */${stat.size}` });
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      status = 206;
    }
    headers['Content-Length'] = String(Math.max(0, end - start + 1));
    response.writeHead(status, headers);
    if (request.method === 'HEAD' || !stat.size) response.end();
    else await pipeline(handle.createReadStream({ start, end, autoClose: false }), response);
  } catch (error) {
    if (response.headersSent) response.destroy();
    else if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) respond(response, 404, 'Not found');
    else throw error;
  } finally { await handle?.close(); }
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Dox-Auth', 'required');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(request.url, 'https://dox.invalid');
    if (url.pathname === '/auth/login' && request.method === 'POST') return await login(request, response);
    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      if (!sameOrigin(request)) return respond(response, 403, 'Invalid request origin');
      sessions.delete(sessionToken(request));
      return respond(response, 204, '', { 'Set-Cookie': cookie('', 0) });
    }
    if (!['GET', 'HEAD'].includes(request.method)) return respond(response, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    if (url.pathname === '/login') {
      if (authenticated(request)) return redirect(response, safeReturn(url.searchParams.get('return')));
      return loginPage(response, url.searchParams.get('return'));
    }
    if (url.pathname === '/auth/session') {
      return respond(response, authenticated(request) ? 200 : 401,
        JSON.stringify({ authenticated: authenticated(request) }), { 'Content-Type': 'application/json' });
    }
    if (!authenticated(request)) {
      if (request.headers['sec-fetch-mode'] === 'navigate' || request.headers.accept?.includes('text/html')) {
        return redirect(response, `/login?return=${encodeURIComponent(safeReturn(request.url))}`);
      }
      return respond(response, 401, 'Authentication required');
    }
    await serveFile(request, response, url.pathname);
  } catch {
    // Do not log request bodies, credentials, or cookie values.
    if (response.headersSent) response.destroy();
    else respond(response, 500, 'Could not serve this request');
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () => console.log('dox website listening'));
