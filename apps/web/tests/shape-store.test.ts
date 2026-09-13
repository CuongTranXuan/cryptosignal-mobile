import { beforeEach, describe, expect, it } from "vitest";
import type { PatternShape } from "../lib/pattern-shape";
import { useShapeStore } from "../lib/stores/shape-store";

const polyline = (overrides: Partial<PatternShape> = {}): PatternShape => ({
  id: "shape-1",
  symbol: "BTCUSDT",
  interval: "1h",
  kind: "polyline",
  name: "Triangle",
  status: "preview",
  source: "agent",
  confidence: 0.8,
  points: [
    { time: 100, price: 10 },
    { time: 200, price: 20 },
    { time: 300, price: 15 },
  ],
  priceLow: null,
  priceHigh: null,
  ...overrides,
});

describe("useShapeStore", () => {
  beforeEach(() => {
    useShapeStore.setState({ shapes: [], selectedId: null });
  });

  it("preview does not appear in committed(); commit moves them", () => {
    const store = useShapeStore.getState();
    store.setPreview([polyline({ id: "p1" })]);

    expect(useShapeStore.getState().previews()).toHaveLength(1);
    expect(useShapeStore.getState().committed()).toHaveLength(0);

    store.commitPreview();

    expect(useShapeStore.getState().previews()).toHaveLength(0);
    expect(useShapeStore.getState().committed()).toEqual([
      expect.objectContaining({ id: "p1", status: "committed" }),
    ]);
  });

  it("setPreview replaces preview shapes and leaves committed intact", () => {
    const store = useShapeStore.getState();
    store.setPreview([polyline({ id: "old" })]);
    store.commitPreview();
    store.setPreview([polyline({ id: "new-a" }), polyline({ id: "new-b", name: "B" })]);

    const state = useShapeStore.getState();
    expect(state.committed().map((s) => s.id)).toEqual(["old"]);
    expect(state.previews().map((s) => s.id)).toEqual(["new-a", "new-b"]);
    expect(state.shapes).toHaveLength(3);
  });

  it("remove deletes a shape by id", () => {
    const store = useShapeStore.getState();
    store.setPreview([polyline({ id: "keep" }), polyline({ id: "gone" })]);
    store.commitPreview();
    store.remove("gone");

    expect(useShapeStore.getState().shapes.map((s) => s.id)).toEqual(["keep"]);
  });

  it("patchPoints and patchZone update the matching shape", () => {
    const store = useShapeStore.getState();
    store.setPreview([
      polyline({ id: "line" }),
      polyline({
        id: "zone",
        kind: "zone",
        points: [
          { time: 100, price: 10 },
          { time: 200, price: 20 },
        ],
        priceLow: 10,
        priceHigh: 20,
      }),
    ]);
    store.commitPreview();

    store.patchPoints("line", [
      { time: 110, price: 11 },
      { time: 210, price: 21 },
      { time: 310, price: 16 },
    ]);
    store.patchZone("zone", 12, 22);

    const state = useShapeStore.getState();
    expect(state.shapes.find((s) => s.id === "line")?.points[0]).toEqual({ time: 110, price: 11 });
    expect(state.shapes.find((s) => s.id === "zone")).toMatchObject({
      priceLow: 12,
      priceHigh: 22,
    });
  });

  it("select and clearAll manage selection and all shapes", () => {
    const store = useShapeStore.getState();
    store.setPreview([polyline({ id: "a" })]);
    store.select("a");
    expect(useShapeStore.getState().selectedId).toBe("a");

    store.clearAll();
    expect(useShapeStore.getState().shapes).toEqual([]);
    expect(useShapeStore.getState().selectedId).toBeNull();
  });
});
