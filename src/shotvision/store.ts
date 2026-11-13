// ShotVision local store (AsyncStorage). Sessions + shots live on-device for
// now — the CV feature is still experimental. The API here mirrors what a
// Supabase-backed version would look like (see SHOTVISION_PLAN.md schema), so
// swapping the backend later is mechanical.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ShotSession, ShotVisionShot } from './types';

export type NewSession = Partial<Omit<ShotSession, 'id' | 'createdAt' | 'shotIds'>>;

const K_SESSIONS = 'sv:sessions';
const K_SHOTS = 'sv:shots';

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

export async function listSessions(): Promise<ShotSession[]> {
  const s = await readArr<ShotSession>(K_SESSIONS);
  return s
    .filter(x => x.saved !== false)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getSession(id: string): Promise<ShotSession | null> {
  return (await readArr<ShotSession>(K_SESSIONS)).find(s => s.id === id) ?? null;
}

export async function createSession(init: NewSession = {}): Promise<ShotSession> {
  const sessions = await readArr<ShotSession>(K_SESSIONS);
  const session: ShotSession = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    shotIds: [],
    mode: init.mode ?? 'practice',
    saved: init.saved ?? (init.mode === 'sim'),
    ...init,
  };
  await writeArr(K_SESSIONS, [session, ...sessions]);
  return session;
}

export async function updateSession(id: string, patch: Partial<ShotSession>): Promise<void> {
  const sessions = await readArr<ShotSession>(K_SESSIONS);
  await writeArr(K_SESSIONS, sessions.map(s => (s.id === id ? { ...s, ...patch } : s)));
}

export async function renameSession(id: string, label: string): Promise<void> {
  return updateSession(id, { label });
}

export async function deleteSession(id: string): Promise<void> {
  const sessions = await readArr<ShotSession>(K_SESSIONS);
  const shots = await readArr<ShotVisionShot>(K_SHOTS);
  await writeArr(K_SESSIONS, sessions.filter(s => s.id !== id));
  await writeArr(K_SHOTS, shots.filter(sh => sh.sessionId !== id));
}

// ── Shots ──────────────────────────────────────────────────────────────────

export async function listShots(sessionId?: string): Promise<ShotVisionShot[]> {
  const all = await readArr<ShotVisionShot>(K_SHOTS);
  const filtered = sessionId ? all.filter(s => s.sessionId === sessionId) : all;
  return filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getShot(id: string): Promise<ShotVisionShot | null> {
  return (await readArr<ShotVisionShot>(K_SHOTS)).find(s => s.id === id) ?? null;
}

export async function addShot(
  shot: Omit<ShotVisionShot, 'id' | 'createdAt'>,
): Promise<ShotVisionShot> {
  const full: ShotVisionShot = { ...shot, id: uuid(), createdAt: new Date().toISOString() };
  const shots = await readArr<ShotVisionShot>(K_SHOTS);
  await writeArr(K_SHOTS, [full, ...shots]);

  const sessions = await readArr<ShotSession>(K_SESSIONS);
  await writeArr(
    K_SESSIONS,
    sessions.map(s =>
      s.id === shot.sessionId ? { ...s, shotIds: [full.id, ...s.shotIds] } : s,
    ),
  );
  return full;
}

export async function deleteShot(id: string): Promise<void> {
  const shots = await readArr<ShotVisionShot>(K_SHOTS);
  const shot = shots.find(s => s.id === id);
  await writeArr(K_SHOTS, shots.filter(s => s.id !== id));
  if (shot) {
    const sessions = await readArr<ShotSession>(K_SESSIONS);
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
export async function clearShotVision(): Promise<void> {
  await AsyncStorage.multiRemove([K_SESSIONS, K_SHOTS]);
}
