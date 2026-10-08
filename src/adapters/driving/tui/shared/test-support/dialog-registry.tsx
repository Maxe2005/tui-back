// tui/shared/test-support: every dialog the TUI can show, each with an adversarial fixture.
// The size matrix renders them all; the registry-coverage test fails when a source file that
// renders a ModalDialog is missing here. `embedded` dialogs are opened by their zone's own local
// state, so the matrix reaches them through the owning zone instead.
import { createElement, type ReactElement } from 'react';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import { createAppStore } from '../../store/app-store.js';
import { createFilterablePickListState } from '../components/filterable-pick-list.js';
import { KeybindingHelp } from '../components/keybinding-help.js';
import { IssuesDialogView } from '../../zones/edts/dialogs/issues-dialog.js';
import { DeleteDialogView } from '../../zones/edts/dialogs/delete-dialog.js';
import { ServiceActionsDialogView } from '../../zones/edts/dialogs/service-actions-dialog.js';
import { AddToEdtDialogView } from '../../zones/edts/dialogs/add-to-edt-dialog.js';
import { ModifyDialogView } from '../../zones/edts/dialogs/modify-dialog.js';
import { SwitchDialogView } from '../../zones/edts/dialogs/switch-dialog.js';
import { QuickPickDialogView } from '../../zones/edts/dialogs/quick-pick-dialog.js';
import { CreateWizardView } from '../../zones/edts/dialogs/create-wizard/create-wizard.js';
import {
  initialAddToEdtDialog,
  initialCreateDialog,
  initialDeleteDialog,
  initialModifyDialog,
  initialQuickPickDialog,
  initialServiceActionsDialog,
  initialSwitchDialog,
} from '../../zones/edts/edts-zone.logic.js';
import { UpdateServicePickDialog } from '../../zones/update/update-service-pick-dialog.js';
import { UpdateServiceMenuDialog } from '../../zones/update/update-service-menu-dialog.js';
import { LogFilterEditor } from '../../zones/logs/log-filter-editor.js';
import { CommandBar } from '../command-bar.js';
import { RepoRegistryScreen } from '../repo-registry-screen.js';
import { SettingsScreen } from '../settings-screen.js';

export const LONG_TEXT = 'x'.repeat(5000);
export const MULTILINE_ERROR = `first line of a failure\n${'\u001b[31mred\u001b[0m '.repeat(40)}\nthird line ${LONG_TEXT}`;

export function adversarialServices(count = 200): ServiceBranchDivergence[] {
  return Array.from({ length: count }, (_, i) => ({
    service: `service-with-a-very-long-name-${i}-${'n'.repeat(60)}`,
    path: `/repos/service-${i}`,
    isMember: i % 3 === 0,
    branch: `feature/${'b'.repeat(80)}-${i}`,
    ahead: i,
    behind: i,
    status: 'current' as const,
    sharedBranch: 'development',
    protectedBranches: [],
  }));
}

export function adversarialEdt(memberCount = 60): EdtRegistryEntry {
  return {
    ulid: 'ulid-0',
    topic: `topic-${'t'.repeat(120)}`,
    createdAt: '2026-01-01T00:00:00Z',
    status: 'active',
    members: adversarialServices(memberCount).map((s) => ({ service: s.service, repoPath: s.path, branch: s.branch ?? 'main' })),
  };
}

export function failedRows(count = 300) {
  return Array.from({ length: count }, (_, i) => ({ service: `svc-${i}`, code: 'branch-exists', message: MULTILINE_ERROR }));
}

// `file` is the source file whose ModalDialog this entry covers, relative to the tui directory.
export type DialogEntry =
  | { id: string; file: string; render: (rows: number) => ReactElement }
  | { id: string; file: string; embedded: 'update' | 'routes' };

const edt = adversarialEdt();
const services = adversarialServices();
const store = () => createAppStore();

export const DIALOG_REGISTRY: readonly DialogEntry[] = [
  {
    id: 'edts/issues',
    file: 'zones/edts/dialogs/issues-dialog.tsx',
    render: () =>
      createElement(IssuesDialogView, {
        unreachable: Array.from({ length: 80 }, (_, i) => `/repos/unreachable-${i}-${'u'.repeat(200)}`),
        errors: Array.from({ length: 80 }, (_, i) => ({ path: `/repos/broken-${i}`, code: 'git-error', message: MULTILINE_ERROR })) as never,
      }),
  },
  {
    id: 'edts/delete',
    file: 'zones/edts/dialogs/delete-dialog.tsx',
    render: () =>
      createElement(DeleteDialogView, {
        dialog: {
          ...initialDeleteDialog(edt, false),
          memberRows: services.map((s) => ({
            repoPath: s.path,
            service: s.service,
            branch: s.branch ?? 'main',
            merged: false,
            clean: false,
            disposition: 'leave' as const,
            statusError: MULTILINE_ERROR,
          })),
          failedRows: failedRows(),
          error: MULTILINE_ERROR,
        },
      }),
  },
  {
    id: 'edts/service-actions',
    file: 'zones/edts/dialogs/service-actions-dialog.tsx',
    render: (rows) =>
      createElement(ServiceActionsDialogView, {
        dialog: { ...initialServiceActionsDialog(edt, '/repos/a', 'a'.repeat(300)), failedRows: failedRows(), error: MULTILINE_ERROR },
        maxRows: rows,
      }),
  },
  {
    id: 'edts/add-to-edt',
    file: 'zones/edts/dialogs/add-to-edt-dialog.tsx',
    render: (rows) =>
      createElement(AddToEdtDialogView, {
        dialog: { ...initialAddToEdtDialog(edt, '/repos/a', 'a'.repeat(300), 'feature/x', 'development'), failedRows: failedRows(), error: MULTILINE_ERROR },
        maxRows: rows,
      }),
  },
  {
    id: 'edts/modify',
    file: 'zones/edts/dialogs/modify-dialog.tsx',
    render: (rows) =>
      createElement(ModifyDialogView, {
        dialog: { ...initialModifyDialog(edt), failedRows: failedRows(), error: MULTILINE_ERROR },
        candidates: services,
        candidateState: 'ready',
        maxRows: rows,
      }),
  },
  {
    id: 'edts/switch',
    file: 'zones/edts/dialogs/switch-dialog.tsx',
    render: (rows) =>
      createElement(SwitchDialogView, {
        dialog: { ...initialSwitchDialog(edt), failedRows: failedRows(), error: MULTILINE_ERROR },
        switchDirtyRepos: null,
        maxVisibleRows: rows,
      }),
  },
  {
    id: 'edts/quick-pick',
    file: 'zones/edts/dialogs/quick-pick-dialog.tsx',
    render: () =>
      createElement(QuickPickDialogView, {
        dialog: initialQuickPickDialog('switch', MULTILINE_ERROR),
        pool: Array.from({ length: 200 }, (_, i) => ({ ...edt, ulid: `u${i}`, topic: `topic-${i}-${'t'.repeat(200)}` })),
      }),
  },
  {
    id: 'edts/create-wizard',
    file: 'zones/edts/dialogs/create-wizard/create-wizard.tsx',
    render: (rows) =>
      createElement(CreateWizardView, {
        dialog: initialCreateDialog(),
        candidates: services,
        candidateState: 'ready',
        edtsRows: [edt],
        maxRows: rows,
        maxVisibleRows: rows,
      }),
  },
  {
    id: 'update/service-pick',
    file: 'zones/update/update-service-pick-dialog.tsx',
    render: () =>
      createElement(UpdateServicePickDialog, {
        state: createFilterablePickListState(),
        candidates: services.map((s) => ({ service: s.service, repoPath: s.path })),
      }),
  },
  {
    id: 'update/service-menu',
    file: 'zones/update/update-service-menu-dialog.tsx',
    render: () => createElement(UpdateServiceMenuDialog, { service: 's'.repeat(500), cursor: 0 }),
  },
  {
    id: 'logs/filter-editor',
    file: 'zones/logs/log-filter-editor.tsx',
    render: (rows) =>
      createElement(LogFilterEditor, {
        editor: { scope: 'global', repoPath: null, mode: 'text', query: '', cursor: 0, level: null, error: MULTILINE_ERROR } as never,
        serviceName: 's'.repeat(500),
        history: Array.from({ length: 300 }, (_, i) => `history-entry-${i}-${'h'.repeat(100)}`),
        gridMaxRows: 8,
        gridCursor: { column: 0, row: 0 },
        gridScrollOffset: 0,
        gridAvailableWidth: 60,
        gridAvailableHeight: Math.max(1, rows - 12),
      }),
  },
  { id: 'shared/keybinding-help', file: 'shared/components/keybinding-help.tsx', render: () => createElement(KeybindingHelp, { useStore: helpStore() }) },
  { id: 'shared/command-bar', file: 'shared/command-bar.tsx', render: () => createElement(CommandBar, { useStore: store(), onClose: () => {} }) },
  { id: 'shared/repo-registry', file: 'shared/repo-registry-screen.tsx', render: () => createElement(RepoRegistryScreen, { useStore: registryStore() }) },
  { id: 'shared/settings', file: 'shared/settings-screen.tsx', render: () => createElement(SettingsScreen, { useStore: store(), onClose: () => {} }) },
  { id: 'update/config-panels', file: 'zones/update/update-config-panels.tsx', embedded: 'update' },
  { id: 'update/zone', file: 'zones/update/update-zone.tsx', embedded: 'update' },
  { id: 'routes/zone', file: 'zones/routes/routes-zone.tsx', embedded: 'routes' },
];

function helpStore() {
  const s = store();
  s.setState({ helpOpen: true } as never);
  return s;
}

function registryStore() {
  const s = store();
  s.setState({
    registryScreenOpen: true,
    registryScanStatus: 'idle',
    registryScanResult: {
      candidates: Array.from({ length: 300 }, (_, i) => `/very/long/path/${'p'.repeat(100)}/repo-${i}`),
      skipped: Array.from({ length: 300 }, (_, i) => `/skipped/${'s'.repeat(100)}/${i}`),
    },
    registryScanError: MULTILINE_ERROR,
  } as never);
  return s;
}
