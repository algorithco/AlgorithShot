// Library state: the current query, loaded items, selection and overview.

import { create } from "zustand";
import { api, type ListQuery, type Overview, type Shot } from "../shared/api";

const PAGE = 400;

type Filter = NonNullable<ListQuery["filter"]>;

type State = {
  search: string;
  filter: Filter;
  app: string;
  items: Shot[];
  total: number;
  loading: boolean;
  overview: Overview | null;
  selected: Set<string>;
  anchor: string | null;
  setQuery: (q: Partial<Pick<State, "search" | "filter" | "app">>) => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  select: (id: string, how: "only" | "toggle" | "range") => void;
  selectAll: () => void;
  clearSelection: () => void;
};

let seq = 0;

export const useLibrary = create<State>((set, get) => ({
  search: "",
  filter: "all",
  app: "",
  items: [],
  total: 0,
  loading: false,
  overview: null,
  selected: new Set(),
  anchor: null,

  setQuery: (q) => {
    set({ ...q, selected: new Set(), anchor: null });
    get().refresh();
  },

  refresh: async () => {
    const my = ++seq;
    const { search, filter, app, items } = get();
    set({ loading: true });
    try {
      const [res, overview] = await Promise.all([
        api.list({ search, filter, app, offset: 0, limit: Math.max(PAGE, items.length) }),
        api.overview(),
      ]);
      if (my !== seq) return;
      const ids = new Set(res.items.map((s) => s.id));
      const selected = new Set([...get().selected].filter((id) => ids.has(id)));
      set({ items: res.items, total: res.total, overview, selected, loading: false });
    } catch (e) {
      if (my === seq) set({ loading: false });
      throw e;
    }
  },

  loadMore: async () => {
    const { items, total, loading, search, filter, app } = get();
    if (loading || items.length >= total) return;
    set({ loading: true });
    const res = await api.list({ search, filter, app, offset: items.length, limit: PAGE });
    set((s) => ({ items: [...s.items, ...res.items], total: res.total, loading: false }));
  },

  select: (id, how) => {
    const { selected, anchor, items } = get();
    if (how === "only") {
      set({ selected: new Set([id]), anchor: id });
    } else if (how === "toggle") {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      set({ selected: next, anchor: id });
    } else {
      const a = items.findIndex((s) => s.id === (anchor ?? id));
      const b = items.findIndex((s) => s.id === id);
      const [from, to] = a < b ? [a, b] : [b, a];
      set({ selected: new Set(items.slice(Math.max(0, from), to + 1).map((s) => s.id)) });
    }
  },

  selectAll: () => set((s) => ({ selected: new Set(s.items.map((i) => i.id)) })),
  clearSelection: () => set({ selected: new Set(), anchor: null }),
}));
