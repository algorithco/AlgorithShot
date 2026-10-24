// Settings shared by every window. Each page loads them once and follows
// the `settings:changed` event, so a change in one window shows everywhere.

import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { api, type Settings } from "./api";

type Store = {
  settings: Settings | null;
  load: () => Promise<Settings>;
  update: (patch: Partial<Settings>) => Promise<Settings>;
};

export const useSettings = create<Store>((set, get) => ({
  settings: null,
  load: async () => {
    const s = await api.getSettings();
    set({ settings: s });
    return s;
  },
  update: async (patch) => {
    const current = get().settings ?? (await get().load());
    const saved = await api.saveSettings({ ...current, ...patch, hotkeys: { ...current.hotkeys, ...(patch.hotkeys ?? {}) } });
    set({ settings: saved });
    return saved;
  },
}));

let following = false;

/** Loads settings and keeps them in sync with the other windows. */
export async function initSettings(): Promise<Settings> {
  const s = await useSettings.getState().load();
  if (!following) {
    following = true;
    await listen<Settings>("settings:changed", (e) => useSettings.setState({ settings: e.payload }));
  }
  return s;
}
