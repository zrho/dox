/* EXPORT_CONFIGURATION */
const ROOT = new URL('./', self.location.href);
const NAMESPACE = `dox-reader:${ROOT.pathname}`;
const CORE_CACHE = `${NAMESPACE}:snapshot:${SNAPSHOT}`;
const ATTACHMENT_CACHE = `${NAMESPACE}:attachments`;
const urls = new Set(RESOURCES.map(resource => new URL(resource.url, ROOT).href));
const attachments = new Set(ATTACHMENTS.map(path => new URL(path, ROOT).href));

async function announce(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.filter(client => client.url.startsWith(ROOT.href)).forEach(client => client.postMessage({ scope: ROOT.href, snapshot: SNAPSHOT, ...message }));
}
async function completeSnapshot() {
  const present = new Set((await (await caches.open(CORE_CACHE)).keys()).map(request => request.url));
  return [...urls].every(url => present.has(url));
}
let downloading;
function downloadSnapshot() {
  if (downloading) return downloading;
  downloading = (async () => {
    if (await completeSnapshot()) { await announce({ type: 'ready' }); return; }
    const cache = await caches.open(CORE_CACHE);
    try {
      let completed = 0;
      for (let start = 0; start < RESOURCES.length; start += 6) {
        const batch = await Promise.allSettled(RESOURCES.slice(start, start + 6).map(async resource => {
          const url = new URL(resource.url, ROOT).href;
          const response = await fetch(url, { cache: 'reload' });
          if (!response.ok || response.redirected) throw new Error('Snapshot download failed');
          const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
          const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
          if (actual !== resource.hash) throw new Error('Website changed during download; retry after deployment finishes');
          await cache.put(url, response);
          await announce({ type: 'progress', completed: ++completed, total: RESOURCES.length });
        }));
        const failed = batch.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
      }
      await announce({ type: 'ready' });
    } catch (error) {
      await caches.delete(CORE_CACHE);
      await announce({ type: 'failed', message: String(error.message || error) });
      throw error;
    }
  })().finally(() => { downloading = undefined; });
  return downloading;
}
self.addEventListener('install', event => { event.waitUntil(downloadSnapshot()); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(`${NAMESPACE}:snapshot:`) && name !== CORE_CACHE) await caches.delete(name);
    }
    const cache = await caches.open(ATTACHMENT_CACHE);
    for (const request of await cache.keys()) {
      if (!attachments.has(request.url)) await cache.delete(request);
    }
    await self.clients.claim();
    await announce({ type: 'active' });
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'activate') self.skipWaiting();
  if (event.data?.type === 'repair') event.waitUntil(downloadSnapshot().then(() => announce({ type: 'active' })));
  if (event.data?.type === 'status') event.waitUntil((async () => {
    const complete = await completeSnapshot();
    event.source?.postMessage({ scope: ROOT.href, snapshot: SNAPSHOT, type: complete ? 'active' : 'failed', message: 'Offline files are missing. Reconnect and retry the download' });
  })());
});
async function attachmentResponse(request) {
  const cached = await (await caches.open(ATTACHMENT_CACHE)).match(request.url);
  if (!cached) return fetch(request);
  const range = request.headers.get('range');
  if (!range) return cached;
  // PDF viewers commonly request byte ranges, including while offline.
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416 });
  const bytes = await cached.arrayBuffer();
  const start = match[1] ? Number(match[1]) : Math.max(0, bytes.byteLength - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
  if (start > end || start >= bytes.byteLength) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.byteLength}` } });
  const headers = new Headers(cached.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${bytes.byteLength}`);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  headers.delete('Content-Encoding');
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  if (attachments.has(url.href)) {
    event.respondWith(attachmentResponse(request));
  } else {
    const appNavigation = request.mode === 'navigate' && (url.pathname === ROOT.pathname || url.pathname === `${ROOT.pathname}index.html`);
    if (!urls.has(url.href) && !appNavigation) return;
    const key = appNavigation ? new URL('index.html', ROOT).href : url.href;
    event.respondWith((async () => (await (await caches.open(CORE_CACHE)).match(key)) || new Response('Offline snapshot unavailable. Reconnect to download it again.', { status: 503 }))());
  }
});
