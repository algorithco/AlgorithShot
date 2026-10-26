import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasHTMLAttributes, PointerEvent as ReactPointerEvent, ReactElement, RefObject } from "react";
import type { Mark } from "./doc";
import { Stage, type Options } from "./Stage";

// Invoke the real canvas event handlers without a DOM renderer. Effects that
// size or paint the canvas are independent of these gesture behavior tests.
vi.mock("react", async (importOriginal: <T>() => Promise<T>) => ({
  ...await importOriginal<typeof import("react")>(),
  useCallback: <T>(callback: T) => callback,
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: <T>(initial: T) => ({ current: initial }),
  useState: <T>(initial: T | (() => T)) => [typeof initial === "function" ? (initial as () => T)() : initial, vi.fn()],
}));
vi.mock("react-dom", () => ({ flushSync: (action: () => void) => action() }));
vi.mock("../shared/i18n", () => ({ useT: () => (key: string) => key }));

type Props = Parameters<typeof Stage>[0];
type CanvasProps = CanvasHTMLAttributes<HTMLCanvasElement> & { ref: RefObject<HTMLCanvasElement | null> };
type Point = { x: number; y: number };

const OPTIONS: Options = {
  color: "#123456", highlight: "#FEDCBA", width: 24, opacity: 0.4,
  fillShape: false, hide: "pixelate", strength: 14, eraseMode: "brush",
  brush: 28, axis: "horizontal", textSize: 28, stepSize: 34,
};

function setup(overrides: Partial<Props> = {}) {
  const calls = {
    onMarks: vi.fn<Props["onMarks"]>(), onOp: vi.fn<Props["onOp"]>(),
    onSelect: vi.fn<Props["onSelect"]>(), onView: vi.fn<Props["onView"]>(),
  };
  const props: Props = {
    base: null, version: 0, doc: { width: 400, height: 300, ops: [], marks: [] },
    tool: "marker", opts: { ...OPTIONS }, view: { zoom: 1, x: 0, y: 0 },
    selected: null, crop: null, cropRatio: null,
    onCrop: vi.fn(), onFill: vi.fn(), onCursor: vi.fn(),
    onStageSize: vi.fn(), onPickColor: vi.fn(),
    ...calls, ...overrides,
  };
  const root = Stage(props);
  const children = (root.props as { children: ReactElement[] }).children;
  const element = children.find((child) => child?.type === "canvas") as ReactElement<CanvasProps>;
  const captured = new Set<number>();
  const canvas = {
    getBoundingClientRect: () => ({ left: 40, top: 60 }),
    setPointerCapture: vi.fn((id: number) => { captured.add(id); }),
    releasePointerCapture: vi.fn((id: number) => { captured.delete(id); }),
    hasPointerCapture: (id: number) => captured.has(id),
    focus: vi.fn(),
  };
  element.props.ref.current = canvas as unknown as HTMLCanvasElement;

  const client = ({ x, y }: Point) => ({ clientX: 40 + props.view.x + x * props.view.zoom, clientY: 60 + props.view.y + y * props.view.zoom });
  const pointer = (point: Point, overrides: Partial<ReactPointerEvent<HTMLCanvasElement>> = {}, coalesced?: Point[]) => {
    const position = client(point);
    const nativeEvent = {
      ...position,
      getCoalescedEvents: coalesced === undefined ? undefined : () => coalesced.map(client),
    };
    return {
      ...position, nativeEvent, pointerId: 1, isPrimary: true, button: 0,
      shiftKey: false, preventDefault: vi.fn(), ...overrides,
    } as unknown as ReactPointerEvent<HTMLCanvasElement>;
  };
  return { props, handlers: element.props, canvas, captured, pointer, ...calls };
}

beforeEach(() => { vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1)); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Stage paint gestures", () => {
  it("draws a bent marker stroke over an existing annotation without moving it or adding a rectangle", () => {
    const existing: Mark = { id: "existing", kind: "box", rect: { x: 10, y: 10, w: 120, h: 80 }, color: "#000000", width: 4 };
    const original = structuredClone(existing);
    const s = setup({ selected: existing.id, doc: { width: 400, height: 300, ops: [], marks: [existing] } });
    s.handlers.onPointerDown!(s.pointer({ x: 10, y: 20 }));
    s.handlers.onPointerMove!(s.pointer({ x: 90, y: 70 }, {}, [{ x: 35, y: 20 }, { x: 65, y: 70 }]));
    s.handlers.onPointerUp!(s.pointer({ x: 130, y: 95 }));

    expect(s.onMarks).toHaveBeenCalledOnce();
    const [marks] = s.onMarks.mock.calls[0];
    expect(marks).toHaveLength(2);
    expect(marks[0]).toBe(existing);
    expect(existing).toEqual(original);
    expect(marks[1]).toMatchObject({
      kind: "stroke", tool: "marker", color: "#FEDCBA", width: 24, opacity: 0.4,
      points: [{ x: 10, y: 20 }, { x: 35, y: 20 }, { x: 65, y: 70 }, { x: 90, y: 70 }, { x: 130, y: 95 }],
    });
    expect(s.onOp.mock.calls).toEqual([]);
    expect(s.onView.mock.calls).toEqual([]);
    expect(s.onSelect.mock.calls).toEqual([[null]]);
    expect(s.captured.size).toBe(0);
  });

  it("converts offset and zoomed canvas coordinates for all sampled points", () => {
    const s = setup({ tool: "pen", view: { zoom: 2.5, x: 75, y: -20 } });
    s.handlers.onPointerDown!(s.pointer({ x: 12, y: 18 }));
    s.handlers.onPointerMove!(s.pointer({ x: 55, y: 38 }, {}, [{ x: 30, y: 50 }]));
    s.handlers.onPointerUp!(s.pointer({ x: 70, y: 22 }));
    expect(s.onMarks.mock.calls[0][0][0]).toMatchObject({
      kind: "stroke", tool: "pen", color: "#123456",
      points: [{ x: 12, y: 18 }, { x: 30, y: 50 }, { x: 55, y: 38 }, { x: 70, y: 22 }],
    });
    expect(s.canvas.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("commits a tap as one dot and includes the release point when no move event arrives", () => {
    const tap = setup({ tool: "pencil" });
    tap.handlers.onPointerDown!(tap.pointer({ x: 22, y: 34 }));
    tap.handlers.onPointerUp!(tap.pointer({ x: 22, y: 34 }));
    expect(tap.onMarks.mock.calls[0][0][0]).toMatchObject({ kind: "stroke", tool: "pencil", points: [{ x: 22, y: 34 }] });

    const fast = setup({ tool: "pen" });
    fast.handlers.onPointerDown!(fast.pointer({ x: 15, y: 25 }));
    fast.handlers.onPointerUp!(fast.pointer({ x: 85, y: 90 }, {}, []));
    expect(fast.onMarks.mock.calls[0][0][0]).toMatchObject({ points: [{ x: 15, y: 25 }, { x: 85, y: 90 }] });
  });

  it.each(["cancel", "lost capture"])("discards a gesture on %s and allows the next stroke", (reason) => {
    const s = setup();
    s.handlers.onPointerDown!(s.pointer({ x: 10, y: 10 }));
    s.handlers.onPointerMove!(s.pointer({ x: 20, y: 35 }));
    if (reason === "cancel") s.handlers.onPointerCancel!(s.pointer({ x: 20, y: 35 }));
    else {
      s.captured.clear();
      s.handlers.onLostPointerCapture!(s.pointer({ x: 20, y: 35 }));
    }
    s.handlers.onPointerUp!(s.pointer({ x: 40, y: 45 }));
    expect(s.onMarks.mock.calls).toEqual([]);
    expect(s.onOp.mock.calls).toEqual([]);
    expect(s.captured.size).toBe(0);

    s.handlers.onPointerDown!(s.pointer({ x: 80, y: 50 }, { pointerId: 2 }));
    s.handlers.onPointerUp!(s.pointer({ x: 90, y: 70 }, { pointerId: 2 }));
    expect(s.onMarks).toHaveBeenCalledOnce();
    expect(s.onMarks.mock.calls[0][0][0]).toMatchObject({ points: [{ x: 80, y: 50 }, { x: 90, y: 70 }] });
  });

  it("ignores right clicks, secondary pointers and unrelated pointer movement during a stroke", () => {
    const s = setup();
    s.handlers.onPointerDown!(s.pointer({ x: 10, y: 10 }, { button: 2 }));
    s.handlers.onPointerUp!(s.pointer({ x: 20, y: 20 }, { button: 2 }));
    s.handlers.onPointerDown!(s.pointer({ x: 10, y: 10 }, { isPrimary: false }));
    s.handlers.onPointerUp!(s.pointer({ x: 20, y: 20 }, { isPrimary: false }));
    expect(s.onMarks.mock.calls).toEqual([]);
    expect(s.canvas.setPointerCapture.mock.calls).toEqual([]);

    s.handlers.onPointerDown!(s.pointer({ x: 30, y: 30 }));
    s.handlers.onPointerMove!(s.pointer({ x: 200, y: 200 }, { pointerId: 99, isPrimary: false }));
    s.handlers.onPointerUp!(s.pointer({ x: 40, y: 50 }));
    expect(s.onMarks.mock.calls[0][0][0]).toMatchObject({ points: [{ x: 30, y: 30 }, { x: 40, y: 50 }] });
  });

  it("emits an eraser stroke instead of a colored mark", () => {
    const s = setup({ tool: "erase" });
    s.handlers.onPointerDown!(s.pointer({ x: 20, y: 30 }));
    s.handlers.onPointerMove!(s.pointer({ x: 35, y: 45 }));
    s.handlers.onPointerUp!(s.pointer({ x: 70, y: 50 }));
    expect(s.onMarks.mock.calls).toEqual([]);
    expect(s.onOp.mock.calls).toEqual([[{ kind: "eraseStroke", size: 28, points: [{ x: 20, y: 30 }, { x: 35, y: 45 }, { x: 70, y: 50 }] }]]);
    expect(s.captured.size).toBe(0);
  });

  it("does not start or commit drawing while disabled", () => {
    const s = setup({ disabled: true });
    s.handlers.onPointerDown!(s.pointer({ x: 10, y: 20 }));
    s.handlers.onPointerMove!(s.pointer({ x: 30, y: 40 }));
    s.handlers.onPointerUp!(s.pointer({ x: 50, y: 60 }));
    expect(s.onMarks.mock.calls).toEqual([]);
    expect(s.onOp.mock.calls).toEqual([]);
    expect(s.canvas.setPointerCapture.mock.calls).toEqual([]);
  });
});
