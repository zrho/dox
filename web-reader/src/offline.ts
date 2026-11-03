import { createSignal, onCleanup } from "solid-js";
import type { Attachment, Snapshot } from "./types";

const root = new URL('./', location.href);
const attachmentCache = `dox-reader:${root.pathname}:attachments`;
export function createOffline(snapshot: () => Snapshot | undefined) {
  const [status, setStatus] = createSignal('Preparing offline download…');
  const [waiting, setWaiting] = createSignal(false);
  const [activeSnapshot, setActiveSnapshot] = createSignal<string>();
  const [error, setError] = createSignal(false);
  const [checking, setChecking] = createSignal(false);
  let registration: ServiceWorkerRegistration | undefined;
  let stopped = false;
  let wasControlled = !!navigator.serviceWorker?.controller;
  let observedWorker: ServiceWorker | undefined;
  const message = (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.scope !== root.href || typeof data.type !== 'string') return;
    if (data.type === 'active') {
      setActiveSnapshot(data.snapshot);
      setWaiting(!!registration?.waiting);
      setStatus('Available offline');
      setError(false);
    } else if (data.type === 'progress') {
      setStatus(`${data.snapshot === snapshot()?.snapshot ? 'Downloading for offline use' : 'Downloading update'} · ${data.completed}/${data.total}`);
      setError(false);
    } else if (data.type === 'failed') {
      const previousAvailable = !!activeSnapshot() && activeSnapshot() !== data.snapshot;
      if (!previousAvailable) setActiveSnapshot(undefined);
      setStatus(`${previousAvailable ? 'Available offline · ' : ''}Download failed. ${data.message}.`);
      setError(true);
    }
  };
  const controlled = () => {
    if (wasControlled) location.reload();
    else {
      wasControlled = true;
      navigator.serviceWorker.controller?.postMessage({ type: 'status' });
    }
  };
  const observe = () => {
    if (!registration || stopped) return;
    setWaiting(!!registration.waiting);
    const worker = registration.installing;
    if (!worker || worker === observedWorker) return;
    observedWorker = worker;
    const changed = () => {
      if (stopped) return;
      if (worker.state === 'installed') {
        setWaiting(!!registration?.waiting);
        if (navigator.serviceWorker.controller) setStatus('Update downloaded');
      } else if (worker.state === 'redundant') {
        setStatus('Offline download failed. Reconnect and retry.');
        setError(true);
      }
    };
    worker.addEventListener('statechange', changed);
    cleanupWorkers.push(() => worker.removeEventListener('statechange', changed));
    changed();
  };
  const cleanupWorkers: (() => void)[] = [];
  async function start() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      setStatus('Offline reading requires HTTPS and service worker support');
      return;
    }
    navigator.serviceWorker.addEventListener('message', message);
    navigator.serviceWorker.addEventListener('controllerchange', controlled);
    try {
      registration = await navigator.serviceWorker.register(new URL('sw.js', root), { scope: root.pathname, updateViaCache: 'none' });
      if (stopped) return;
      registration.addEventListener('updatefound', observe);
      observe();
      navigator.serviceWorker.controller?.postMessage({ type: 'status' });
      if (registration.waiting) setStatus('Update downloaded');
    } catch (cause) {
      setStatus(`Offline setup failed: ${String(cause)}`);
      setError(true);
    }
  }
  async function check() {
    if (checking()) return;
    setChecking(true);
    try {
      if (!registration) { await start(); return; }
      setStatus(activeSnapshot() ? 'Available offline · Checking for updates…' : 'Retrying offline download…');
      await registration.update();
      observe();
      if (!registration.installing && !registration.waiting) {
        if (error() || !activeSnapshot()) registration.active?.postMessage({ type: 'repair' });
        else setStatus('Available offline · Up to date');
      }
    } catch {
      setStatus(activeSnapshot() ? 'Available offline · Could not check for updates' : 'Download failed. Reconnect and retry.');
      setError(true);
    } finally { setChecking(false); }
  }
  onCleanup(() => {
    stopped = true;
    navigator.serviceWorker?.removeEventListener('message', message);
    navigator.serviceWorker?.removeEventListener('controllerchange', controlled);
    registration?.removeEventListener('updatefound', observe);
    cleanupWorkers.forEach(cleanup => cleanup());
  });
  return { start, check, status, waiting, error, checking,
    activate: () => registration?.waiting?.postMessage({ type: 'activate' }) };
}
export async function attachmentAvailable(attachment: Attachment) {
  return 'caches' in window && !!(await (await caches.open(attachmentCache)).match(new URL(attachment.url, root).href));
}
export async function saveAttachment(attachment: Attachment) {
  if (!('caches' in window) || !window.isSecureContext) throw new Error('Offline downloads require HTTPS');
  const response = await fetch(new URL(attachment.url, root));
  if (!response.ok || response.redirected) throw new Error('Attachment download failed');
  const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
  const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (actual !== attachment.hash) throw new Error('Attachment changed; update the library before retrying');
  await (await caches.open(attachmentCache)).put(new URL(attachment.url, root).href, response);
}
export async function removeAttachment(attachment: Attachment) {
  await (await caches.open(attachmentCache)).delete(new URL(attachment.url, root).href);
}
