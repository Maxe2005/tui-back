// tui/store/slices: the Dashboard's state — the services and registry-health sections, each with
// its own load status so they fill independently, plus the time of the last completed load.
// Builders run in-process over injected ports; unwired, a section degrades to an error state.
import type { StateCreator } from 'zustand';
import {
  buildDashboardRegistrySummary,
  buildDashboardServices,
  type DashboardRegistrySummary,
  type DashboardServicesSection,
} from '../../../../../core/dashboard/snapshot.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

export type DashboardSectionStatus = 'idle' | 'loading' | 'ready' | 'error';

export type DashboardSlice = {
  dashboardServicesStatus: DashboardSectionStatus;
  dashboardServices: DashboardServicesSection | null;
  dashboardRegistryStatus: DashboardSectionStatus;
  dashboardRegistry: DashboardRegistrySummary | null;
  // Epoch ms of the last load that finished (either section); null before the first one.
  dashboardUpdatedAt: number | null;
  loadDashboard: () => Promise<void>;
};

export function createDashboardSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], DashboardSlice> {
  return (set, get) => ({
    dashboardServicesStatus: 'idle',
    dashboardServices: null,
    dashboardRegistryStatus: 'idle',
    dashboardRegistry: null,
    dashboardUpdatedAt: null,
    loadDashboard: async () => {
      if (get().dashboardServicesStatus === 'loading' || get().dashboardRegistryStatus === 'loading') {
        return;
      }
      if (deps === undefined) {
        set({ dashboardServicesStatus: 'error', dashboardRegistryStatus: 'error', dashboardUpdatedAt: Date.now() });
        return;
      }
      set({ dashboardServicesStatus: 'loading', dashboardRegistryStatus: 'loading' });
      const services = buildDashboardServices(deps).then((result) =>
        set({
          dashboardServicesStatus: result.ok ? 'ready' : 'error',
          dashboardServices: result.ok ? result.data : null,
          dashboardUpdatedAt: Date.now(),
        }),
      );
      const registry = buildDashboardRegistrySummary(deps).then((result) =>
        set({
          dashboardRegistryStatus: result.ok ? 'ready' : 'error',
          dashboardRegistry: result.ok ? result.data : null,
          dashboardUpdatedAt: Date.now(),
        }),
      );
      await Promise.all([services, registry]);
    },
  });
}
