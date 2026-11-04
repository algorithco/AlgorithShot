import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, RefObject } from "react";
import type { CardPayload } from "../shared/api";
import { Card } from "./Card";

const mock = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  layouts: [] as Array<() => void>,
  listeners: new Map<string, (event: { payload: CardPayload }) => void>(),
  initialCard: null as CardPayload | null,
  stateIndex: 0,
  hide: vi.fn(), ready: vi.fn(), loaded: vi.fn(),
}));

vi.mock("react", async (original: <T>() => Promise<T>) => ({
  ...await original<typeof import("react")>(),
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => { mock.effects.push(effect); },
  useLayoutEffect: (effect: () => void) => { mock.layouts.push(effect); },
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(value: T) => [mock.stateIndex++ === 0 ? mock.initialCard : value, vi.fn()],
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (event: { payload: CardPayload }) => void) => {
    mock.listeners.set(name, handler);
    return Promise.resolve(vi.fn());
  }),
}));
vi.mock("@crabnebula/tauri-plugin-drag", () => ({ startDrag: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("../shared/api", () => ({
  api: { cardHide: mock.hide, cardReady: mock.ready, cardLoaded: mock.loaded },
  errorText: String, shotUrl: String, thumbUrl: String,
}));
vi.mock("../shared/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("../shared/settings", () => ({ initSettings: vi.fn(), useSettings: () => 5 }));
vi.mock("../shared/theme", () => ({ useTheme: vi.fn() }));

type CardElement = ReactElement<{
  children: ReactElement<{ ref: RefObject<unknown> }>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}>;
let cleanup: Array<() => void>;

function mount(card: CardPayload): CardElement {
  mock.initialCard = card;
  const root = Card() as CardElement;
  root.props.children.props.ref.current = { offsetWidth: 300, offsetHeight: 100 };
  cleanup = mock.effects.map((effect) => effect()).filter((effect): effect is () => void => typeof effect === "function");
  mock.layouts.forEach((effect) => effect());
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  mock.effects.length = 0;
  mock.layouts.length = 0;
  mock.listeners.clear();
  mock.stateIndex = 0;
  mock.hide.mockResolvedValue(undefined);
  mock.loaded.mockResolvedValue(undefined);
  cleanup = [];
});

afterEach(() => {
  cleanup.forEach((dispose) => dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("countdown card lifetime", () => {
  it("clears the previous quick card's auto-dismiss as soon as a countdown arrives", async () => {
    mount({ kind: "message", text: "Copied", error: false });
    await vi.advanceTimersByTimeAsync(4900);
    mock.listeners.get("card:show")!({ payload: { kind: "countdown", seconds: 10 } });
    await vi.advanceTimersByTimeAsync(11000);
    expect(mock.hide).not.toHaveBeenCalled();
  });

  it("clears a previous mouse-leave dismissal when the countdown arrives", async () => {
    const root = mount({ kind: "message", text: "Copied", error: false });
    root.props.onMouseEnter();
    root.props.onMouseLeave();
    await vi.advanceTimersByTimeAsync(2400);
    mock.listeners.get("card:show")!({ payload: { kind: "countdown", seconds: 10 } });
    await vi.advanceTimersByTimeAsync(11000);
    expect(mock.hide).not.toHaveBeenCalled();
  });

  it("keeps the countdown visible when the pointer leaves it", async () => {
    const root = mount({ kind: "countdown", seconds: 10 });
    root.props.onMouseEnter();
    root.props.onMouseLeave();
    await vi.advanceTimersByTimeAsync(11000);
    expect(mock.hide).not.toHaveBeenCalled();
  });

  it("still dismisses ordinary quick cards after their configured duration", async () => {
    mount({ kind: "message", text: "Copied", error: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mock.hide).toHaveBeenCalledOnce();
  });
});
