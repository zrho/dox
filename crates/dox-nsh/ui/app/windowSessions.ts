import { signal } from "nsh";
import { Window } from "nsh/desktop";
import type { Session } from "./createSession";

const sessions = new Set<Session>();
const syncOwners = signal(new Map<string, string>());
let nextWindow = 0;

export function registerSession(session: Session) {
  sessions.add(session);
  return () => { sessions.delete(session); };
}

export function canQuit() {
  let allowed = true;
  for (const session of sessions) if (!session.canLeaveLibrary()) allowed = false;
  return allowed;
}

export function openWorkspace(component: Parameters<typeof Window.open>[0]) {
  Window.open(component, { id: `workspace-${++nextWindow}`, kind: "normal", closeOnPress: false }).focus();
}

export function isSyncPeer(path: string, id: string) {
  const owner = syncOwners().get(path);
  return owner !== undefined && owner !== id;
}

export function reserveSync(path: string, id: string): (() => void) | undefined {
  if (syncOwners().has(path)) return;
  syncOwners.set(new Map(syncOwners()).set(path, id));
  return () => {
    const next = new Map(syncOwners());
    next.delete(path);
    syncOwners.set(next);
  };
}

export function sessionsFor(path: string) {
  return Array.from(sessions).filter((session) => session.path() === path);
}
