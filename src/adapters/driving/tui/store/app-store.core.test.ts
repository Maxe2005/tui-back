import { describe, it, expect } from "vitest";
import { ZONES } from "../zones/zones.js";
import { defaultZoneRatios } from "../zones/zone-layouts.js";
import { createAppStore } from "./app-store.js";
import { DEFAULT_LIST_RATIO } from "./store.test-support.js";

describe("app store", () => {
  it("scaffolds placeholder cross-zone state: dashboard active, empty events, 2:3 splitter ratios, no active EDT (AD-10)", () => {
    const store = createAppStore();
    const state = store.getState();
    expect(state.activeZone).toBe("dashboard");
    expect(state.activeEdt).toBeNull();
    for (const zone of ZONES) {
      expect(state.zoneEvents[zone.id]).toBe(0);
      expect(state.splitterRatios[zone.id]).toEqual(defaultZoneRatios(zone.id));
    }
  });

  it("defaults resizeMode to null", () => {
    const store = createAppStore();
    expect(store.getState().resizeMode).toBeNull();
  });

  it("covers exactly the six compiled-in zones — no duplicate copy per zone", () => {
    const store = createAppStore();
    const state = store.getState();
    expect(ZONES).toHaveLength(6);
    const zoneIds = ZONES.map((zone) => zone.id);
    expect(Object.keys(state.zoneEvents).sort()).toEqual([...zoneIds].sort());
    expect(Object.keys(state.splitterRatios).sort()).toEqual(
      [...zoneIds].sort(),
    );
  });

  it("switches the active zone and clears pending events for the visited zone", () => {
    const store = createAppStore();
    store.getState().addZoneEvent("logs");
    store.getState().addZoneEvent("logs");
    expect(store.getState().zoneEvents.logs).toBe(2);
    store.getState().setActiveZone("logs");
    expect(store.getState().activeZone).toBe("logs");
    expect(store.getState().zoneEvents.logs).toBe(0);
  });

  it("adds pending background-event counts per zone independently", () => {
    const store = createAppStore();
    store.getState().addZoneEvent("routes");
    store.getState().addZoneEvent("routes");
    store.getState().addZoneEvent("dashboard");
    expect(store.getState().zoneEvents.routes).toBe(2);
    expect(store.getState().zoneEvents.dashboard).toBe(1);
  });

  it("stores the splitter ratio per zone/boundary, clamped to keep both panes usable", () => {
    const store = createAppStore();
    store.getState().setSplitterRatio("edts", 0, 0.5);
    expect(store.getState().splitterRatios.edts[0]).toBe(0.5);
    store.getState().setSplitterRatio("edts", 0, 1);
    expect(store.getState().splitterRatios.edts[0]).toBe(0.8);
    store.getState().setSplitterRatio("edts", 0, 0);
    expect(store.getState().splitterRatios.edts[0]).toBe(0.2);
    expect(store.getState().splitterRatios.dashboard[0]).toBe(DEFAULT_LIST_RATIO);
  });

  // The EDTs zone has 3 independently movable boundaries — each setSplitterRatio call only
  // ever touches the one boundaryIndex it's given, never the other two.
  it("moves only the targeted boundary within a multi-boundary zone", () => {
    const store = createAppStore();
    store.getState().setSplitterRatio("edts", 1, 0.7);
    expect(store.getState().splitterRatios.edts).toEqual([DEFAULT_LIST_RATIO, 0.7, DEFAULT_LIST_RATIO]);
    store.getState().setSplitterRatio("edts", 2, 0.3);
    expect(store.getState().splitterRatios.edts).toEqual([DEFAULT_LIST_RATIO, 0.7, 0.3]);
  });

  it("ignores an out-of-range boundaryIndex rather than writing a sparse array", () => {
    const store = createAppStore();
    const before = store.getState().splitterRatios.dashboard;
    store.getState().setSplitterRatio("dashboard", 5, 0.5);
    expect(store.getState().splitterRatios.dashboard).toEqual(before);
  });

  describe("resizeMode (Ctrl+W keyboard resize-mode)", () => {
    it("enterResizeMode sets the zone with targetBoundary 0", () => {
      const store = createAppStore();
      store.getState().enterResizeMode("edts");
      expect(store.getState().resizeMode).toEqual({ zone: "edts", targetBoundary: 0 });
    });

    it("exitResizeMode clears it back to null", () => {
      const store = createAppStore();
      store.getState().enterResizeMode("edts");
      store.getState().exitResizeMode();
      expect(store.getState().resizeMode).toBeNull();
    });

    it("cycleResizeTargetBoundary wraps across the zone's own boundary count", () => {
      const store = createAppStore();
      store.getState().enterResizeMode("edts");
      store.getState().cycleResizeTargetBoundary();
      expect(store.getState().resizeMode?.targetBoundary).toBe(1);
      store.getState().cycleResizeTargetBoundary();
      expect(store.getState().resizeMode?.targetBoundary).toBe(2);
      store.getState().cycleResizeTargetBoundary();
      expect(store.getState().resizeMode?.targetBoundary).toBe(0);
    });

    it("cycleResizeTargetBoundary('back') reverses, wrapping first to last", () => {
      const store = createAppStore();
      store.getState().enterResizeMode("edts");
      store.getState().cycleResizeTargetBoundary("back");
      expect(store.getState().resizeMode?.targetBoundary).toBe(2);
      store.getState().cycleResizeTargetBoundary("back");
      expect(store.getState().resizeMode?.targetBoundary).toBe(1);
    });

    it("cycleResizeTargetBoundary is a no-op while resizeMode is null", () => {
      const store = createAppStore();
      store.getState().cycleResizeTargetBoundary();
      expect(store.getState().resizeMode).toBeNull();
    });
  });

  it("tracks the active EDT placeholder field (AD-10)", () => {
    const store = createAppStore();
    store.getState().setActiveEdt("edt-01hx2");
    expect(store.getState().activeEdt).toBe("edt-01hx2");
    store.getState().setActiveEdt(null);
    expect(store.getState().activeEdt).toBeNull();
  });

  it("opens and closes the cross-zone help modal (AD-10)", () => {
    const store = createAppStore();
    expect(store.getState().helpOpen).toBe(false);
    store.getState().openHelp();
    expect(store.getState().helpOpen).toBe(true);
    store.getState().closeHelp();
    expect(store.getState().helpOpen).toBe(false);
  });
});
