import { create } from 'zustand';
import { ZONES, type ZoneId } from '../zones/zones.js';

export const DEFAULT_LIST_RATIO = 2 / 5;

export type ZoneEvents = Record<ZoneId, number>;
export type ZoneRatios = Record<ZoneId, number>;

export type AppState = {
  activeZone: ZoneId;
  setActiveZone: (zone: ZoneId) => void;
  zoneEvents: ZoneEvents;
  addZoneEvent: (zone: ZoneId) => void;
  clearZoneEvents: (zone: ZoneId) => void;
  splitterRatios: ZoneRatios;
  setSplitterRatio: (zone: ZoneId, ratio: number) => void;
  activeEdt: string | null;
  setActiveEdt: (edt: string | null) => void;
};

function emptyEvents(): ZoneEvents {
  return {
    dashboard: 0,
    edts: 0,
    update: 0,
    logs: 0,
    routes: 0,
    'shared-types': 0,
  };
}

function emptyRatios(): ZoneRatios {
  return {
    dashboard: DEFAULT_LIST_RATIO,
    edts: DEFAULT_LIST_RATIO,
    update: DEFAULT_LIST_RATIO,
    logs: DEFAULT_LIST_RATIO,
    routes: DEFAULT_LIST_RATIO,
    'shared-types': DEFAULT_LIST_RATIO,
  };
}

export function createAppStore() {
  return create<AppState>()((set) => ({
    activeZone: 'dashboard',
    setActiveZone: (zone) =>
      set((state) => ({
        activeZone: zone,
        zoneEvents: { ...state.zoneEvents, [zone]: 0 },
      })),
    zoneEvents: emptyEvents(),
    addZoneEvent: (zone) =>
      set((state) => ({
        zoneEvents: {
          ...state.zoneEvents,
          [zone]: state.zoneEvents[zone] + 1,
        },
      })),
    clearZoneEvents: (zone) =>
      set((state) => ({
        zoneEvents: { ...state.zoneEvents, [zone]: 0 },
      })),
    splitterRatios: emptyRatios(),
    setSplitterRatio: (zone, ratio) =>
      set((state) => ({
        splitterRatios: { ...state.splitterRatios, [zone]: ratio },
      })),
    activeEdt: null,
    setActiveEdt: (edt) => set({ activeEdt: edt }),
  }));
}

export const useAppStore = createAppStore();
