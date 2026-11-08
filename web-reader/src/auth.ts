import { createSignal } from 'solid-js';

const root = new URL('./', location.href);
const namespace = `dox-reader:${root.pathname}:`;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel(`${namespace}auth`) : undefined;
export const [authenticationEnabled, setAuthenticationEnabled] = createSignal(false);
let signingOut = false;
let cleanup: Promise<void> | undefined;

export function requireLogin() {
  const destination = location.pathname + location.search + location.hash;
  location.replace(new URL(`/login?return=${encodeURIComponent(destination)}`, root));
}
export function assertNotSigningOut() {
  if (signingOut) throw new Error('Signed out');
}
export async function authenticatedFetch(input: string | URL, options?: RequestInit) {
  assertNotSigningOut();
  const response = await fetch(input, options);
  assertNotSigningOut();
  if (response.headers.get('X-Dox-Auth') === 'required') {
    setAuthenticationEnabled(true);
    if (response.status === 401) {
      requireLogin();
      throw new Error('Sign in to open the library');
    }
  }
  return response;
}
export async function checkAuthentication() {
  // This endpoint bypasses the offline worker. An unreachable server leaves
  // downloaded content available; a reachable server can request a new login.
  try { await authenticatedFetch(new URL('auth/session', root), { cache: 'no-store' }); }
  catch { /* Offline reading remains available. */ }
}
export function startAuthentication() {
  const check = () => { if (document.visibilityState === 'visible') void checkAuthentication(); };
  const workerMessage = (event: MessageEvent) => {
    if (event.data?.scope === root.href && event.data.type === 'auth-required') requireLogin();
  };
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  navigator.serviceWorker?.addEventListener('message', workerMessage);
  void checkAuthentication();
  return () => {
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('online', check);
    navigator.serviceWorker?.removeEventListener('message', workerMessage);
  };
}
function stopWorker(worker: ServiceWorker) {
  return new Promise<void>(resolve => {
    const message = new MessageChannel();
    const done = () => { clearTimeout(timeout); message.port1.close(); resolve(); };
    // Older exports do not understand this message. Unregister them anyway.
    const timeout = setTimeout(done, 3000);
    message.port1.onmessage = done;
    try { worker.postMessage({ type: 'logout' }, [message.port2]); }
    catch { done(); }
  });
}
function clearOffline() {
  if (cleanup) return cleanup;
  cleanup = (async () => {
    if ('serviceWorker' in navigator) {
      const registrations = (await navigator.serviceWorker.getRegistrations()).filter(registration => registration.scope === root.href);
      const workers = new Set(registrations.flatMap(registration => [registration.active, registration.waiting, registration.installing]).filter((worker): worker is ServiceWorker => !!worker));
      await Promise.all([...workers].map(stopWorker));
      await Promise.all(registrations.map(registration => registration.unregister()));
    }
    if ('caches' in window) {
      const names = (await caches.keys()).filter(name => name.startsWith(namespace));
      await Promise.all(names.map(name => caches.delete(name)));
    }
  })().catch(error => { cleanup = undefined; throw error; });
  return cleanup;
}
channel?.addEventListener('message', event => {
  if (event.data === 'signed-out') {
    signingOut = true;
    void clearOffline().finally(() => location.replace(new URL('login', root)));
  }
});
export async function signOut() {
  const response = await fetch(new URL('auth/logout', root), { method: 'POST', cache: 'no-store' });
  if (!response.ok) throw new Error('Could not sign out. Reconnect and try again.');
  signingOut = true;
  channel?.postMessage('signed-out');
  await clearOffline();
  location.replace(new URL('login', root));
}
