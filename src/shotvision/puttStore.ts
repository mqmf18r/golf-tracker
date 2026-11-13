// Putt session/shot local store (AsyncStorage) — same shape and conventions
// as store.ts, kept as a separate file/keys rather than genericising store.ts
// so the proven full-swing store stays untouched.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PuttSession, PuttShot } from './putting';

export type NewPuttSession = Partial<Omit<PuttSession, 'id' | 'createdAt' | 'shotIds'>>;

const K_SESSIONS = 'sv:putt:sessions';
const K_SHOTS = 'sv:putt:shots';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function readArr<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}
async function writeArr<T>(key: string, arr: T[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(arr));
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function listPuttSessions(): Promise<PuttSession[]> {
  const s = await readArr<PuttSession>(K_SESSIONS);
  return s
    .filter(x => x.saved !== false)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getPuttSession(id: string): Promise<PuttSession | null> {
  return (await readArr<PuttSession>(K_SESSIONS)).find(s => s.id === id) ?? null;
}

export async function createPuttSession(init: NewPuttSession = {}): Promise<PuttSession> {
  const sessions = await readArr<PuttSession>(K_SESSIONS);
  const session: PuttSession = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    shotIds: [],
    saved: init.saved ?? false,
    ...init,
  };
  await writeArr(K_SESSIONS, [session, ...sessions]);
  return session;
}

export async function updatePuttSession(id: string, patch: Partial<PuttSession>): Promise<void> {
  const sessions = await readArr<PuttSession>(K_SESSIONS);
  await writeArr(K_SESSIONS, sessions.map(s => (s.id === id ? { ...s, ...patch } : s)));
}

export async function deletePuttSession(id: string): Promise<void> {
  const sessions = await readArr<PuttSession>(K_SESSIONS);
  const shots = await readArr<PuttShot>(K_SHOTS);
  await writeArr(K_SESSIONS, sessions.filter(s => s.id !== id));
  await writeArr(K_SHOTS, shots.filter(sh => sh.sessionId !== id));
}

// ── Shots ──────────────────────────────────────────────────────────────────

export async function listPuttShots(sessionId?: string): Promise<PuttShot[]> {
  const all = await readArr<PuttShot>(K_SHOTS);
  const filtered = sessionId ? all.filter(s => s.sessionId === sessionId) : all;
  return filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getPuttShot(id: string): Promise<PuttShot | null> {
  return (await readArr<PuttShot>(K_SHOTS)).find(s => s.id === id) ?? null;
}

export async function addPuttShot(
  shot: Omit<PuttShot, 'id' | 'createdAt'>,
): Promise<PuttShot> {
  const full: PuttShot = { ...shot, id: uuid(), createdAt: new Date().toISOString() };
  const shots = await readArr<PuttShot>(K_SHOTS);
  await writeArr(K_SHOTS, [full, ...shots]);

  const sessions = await readArr<PuttSession>(K_SESSIONS);
  await writeArr(
    K_SESSIONS,
    sessions.map(s =>
      s.id === shot.sessionId ? { ...s, shotIds: [full.id, ...s.shotIds] } : s,
    ),
  );
  return full;
}

export async function deletePuttShot(id: string): Promise<void> {
  const shots = await readArr<PuttShot>(K_SHOTS);
  const shot = shots.find(s => s.id === id);
  await writeArr(K_SHOTS, shots.filter(s => s.id !== id));
  if (shot) {
    const sessions = await readArr<PuttSession>(K_SESSIONS);
    await writeArr(
      K_SESSIONS,
      sessions.map(s =>
        s.id === shot.sessionId
          ? { ...s, shotIds: s.shotIds.filter(x => x !== id) }
          : s,
      ),
    );
  }
}

/** Wipe everything (Settings → reset). */
export async function clearPuttData(): Promise<void> {
  await AsyncStorage.multiRemove([K_SESSIONS, K_SHOTS]);
}
