import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import {
  DEFAULT_LIST_RATIO,
  clampListRatio,
} from '../shared/components/list-detail-split.js';
import { ZONES, type ZoneId } from '../zones/zones.js';

export type AppStore = UseBoundStore<StoreApi<AppState>>;

export type ZoneEvents = Record<ZoneId, number>;
export type ZoneRatios = Record<ZoneId, number>;

export type AppState = {
  activeZone: ZoneId;
  setActiveZone: (zone: ZoneId) => void;
  zoneEvents: ZoneEvents;
  addZoneEvent: (zone: ZoneId) => void;
  splitterRatios: ZoneRatios;
  setSplitterRatio: (zone: ZoneId, ratio: number) => void;
  activeEdt: string | null;
  setActiveEdt: (edt: string | null) => void;
  helpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  launchBannerShown: boolean;
  markLaunchBannerShown: () => void;
  runInProgress: boolean;
};

function emptyEvents(): ZoneEvents {
  return Object.fromEntries(ZONES.map((zone) => [zone.id, 0])) as ZoneEvents;
}

function emptyRatios(): ZoneRatios {
  return Object.fromEntries(
    ZONES.map((zone) => [zone.id, DEFAULT_LIST_RATIO]),
  ) as ZoneRatios;
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
    splitterRatios: emptyRatios(),
    setSplitterRatio: (zone, ratio) =>
      set((state) => ({
        splitterRatios: {
          ...state.splitterRatios,
          [zone]: clampListRatio(ratio),
        },
      })),
    activeEdt: null,
    setActiveEdt: (edt) => set({ activeEdt: edt }),
    helpOpen: false,
    openHelp: () => set({ helpOpen: true }),
    closeHelp: () => set({ helpOpen: false }),
    launchBannerShown: false,
    markLaunchBannerShown: () => set({ launchBannerShown: true }),
    runInProgress: false,
  }));
}

export const useAppStore = createAppStore();

