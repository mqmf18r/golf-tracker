import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, SVSettings, getSettings, saveSettings } from './settings';

// Module-level cache + subscribers so every screen reflects changes immediately.
let cache: SVSettings = DEFAULT_SETTINGS;
let loaded = false;
const subs = new Set<() => void>();

getSettings().then(s => { cache = s; loaded = true; subs.forEach(f => f()); });

export function useSettings() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force(n => n + 1);
    subs.add(f);
    if (!loaded) getSettings().then(s => { cache = s; loaded = true; f(); });
    return () => { subs.delete(f); };
  }, []);

  async function update(patch: Partial<SVSettings>) {
    cache = { ...cache, ...patch };
    subs.forEach(f => f());
    await saveSettings(cache);
  }
  async function updateShow(key: keyof SVSettings['show'], value: boolean) {
    cache = { ...cache, show: { ...cache.show, [key]: value } };
    subs.forEach(f => f());
    await saveSettings(cache);
  }
  async function updateView(key: keyof SVSettings['views'], value: boolean) {
    cache = { ...cache, views: { ...cache.views, [key]: value } };
    subs.forEach(f => f());
    await saveSettings(cache);
  }

  return { settings: cache, update, updateShow, updateView };
}
