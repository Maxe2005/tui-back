import re,subprocess,collections,sys
R=subprocess.check_output(['git','rev-parse','--show-toplevel'],text=True).strip()
import os
OUT=sys.argv[1] if len(sys.argv)>1 else None
files=subprocess.check_output(['git','ls-files','src'],cwd=R,text=True).split('\n')
files=[f for f in files if f]
def direct(d): return sorted(f[len(d)+1:] for f in files if f.startswith(d+'/') and '/' not in f[len(d)+1:])
out=[]
def section(d,story,rules,extra=None,note=''):
    """rules: list of (regex, folder). folder '.' = stays at root."""
    names=direct(d)
    if extra:
        for n,(src_dir,) in extra.items(): pass
    groups=collections.OrderedDict()
    for n in names:
        for rx,fo in rules:
            if re.fullmatch(rx,n):
                groups.setdefault(fo,[]).append(n); break
        else:
            sys.exit(f'UNMATCHED {d}/{n}')
    return groups
def emit(title,d,story,groups,note='',extra_in=None,existing=None):
    total=sum(len(v) for v in groups.values())
    out.append(f'### `{d}` — {total} files (= `git ls-files` direct-file count, non-code files included) → story {story}\n')
    if note: out.append(note+'\n')
    out.append('| Target folder (under this directory) | Files | Count |\n|---|---|---|')
    for fo,v in sorted(groups.items(), key=lambda kv:(kv[0]!='.',kv[0])):
        label='`.` (stays in place)' if fo=='.' else f'`{fo}/`'
        out.append(f'| {label} | {", ".join("`"+x+"`" for x in v)} | {len(v)} |')
    over=[fo for fo,v in groups.items() if len(v)>10]
    out.append('')
    if over: out.append(f'**Warning: still >10 files: {over}**\n'); print('OVER',d,over)
    return groups

T='src/adapters/driving/tui'
# ---- components
comp=[
 (r'index\.ts|ink-smoke\.test\.tsx|render-to-string\.ts','.'),
 (r'(text-input-line|text-edit|suggest-field|branch-autocomplete-input)[.\-a-z]*','inputs'),
 (r'(branch-picker|filterable-pick-list|restart-mode-selector|checkbox-list-item)[.\-a-z]*','pickers'),
 (r'(bounded-list|list-row|menu-list|failed-result-list|service-actions-row)[.\-a-z]*','lists'),
 (r'(modal-dialog|keybinding-help|hints)[.\-a-z]*','dialogs'),
 (r'(fullscreen-frame|zone-layout|zone-placeholder|splitter|detail-pane)[.\-a-z]*','layout'),
 (r'(zone-tab-bar|top-bar|top-bar-footer-split|footer|footer-context)[.\-a-z]*','chrome'),
 (r'(spinner|status-badge|state-line|dim-annotation)[.\-a-z]*','feedback'),
 (r'(truncated-text|scrollable-output)[.\-a-z]*','display'),
]
g_comp=section(T+'/shared/components','14.2',comp)
# ---- shared
sh=[
 (r'README\.md','.'),
 (r'branch-owners-text[.a-z]*','@components/pickers'),
 (r'(command-bar|command-grid)[.\-a-z]*','screens/command-bar'),
 (r'terminal-view[.\-a-z]*','screens/terminal-view'),
 (r'(heal-dialog|realign-dialog)[.\-a-z]*','screens/dialogs'),
 (r'(repo-registry-screen|reset-screen|settings-screen|screens)[.\-a-z]*','screens'),
]
g_sh=section(T+'/shared','14.2',sh)
# ---- hooks (poll folded in)
hk=[(r'.*','.')]
g_hk=section(T+'/shared/hooks','14.2',hk)
g_hk={'.':g_hk['.']+['(from poll/) '+n for n in direct(T+'/shared/poll')]}
# ---- slices
sl=[
 (r'logs-slice[.\-a-z]*','logs'),
 (r'update-slice\.(config)[.\-a-z]*','update/config'),
 (r'update-slice\.(health|incident)[.\-a-z]*','update/health'),
 (r'update-slice\.(run|smart-update)[.\-a-z]*','update/run'),
 (r'update-slice[.\-a-z]*','update'),
 (r'shared-types[.\-a-z]*','shared-types'),
 (r'terminal[.\-a-z]*','terminal'),
 (r'(heal|realign|reset)-slice[.\-a-z]*','maintenance'),
 (r'(edt|dashboard|registry|routes|navigation)-slice[.\-a-z]*','workspace'),
 (r'(command-history|settings)-slice[.\-a-z]*|service-action-ids\.ts','app'),
]
g_sl=section(T+'/store/slices','14.3',sl)
# ---- zones
upd=[
 (r'use-update-[a-z\-]+\.ts','hooks'),
 (r'update-config-[a-z.\-]+','config'),
 (r'update-incidents[a-z.\-]*','incidents'),
 (r'update-(service|detail)-?[a-z.\-]*','services'),
 (r'fullscreen-report[.a-z]*|update-zone\.(report|recap)[.a-z\-]*','report'),
 (r'update-zone\.(blockers|resolvers|status|steps|grouping)[.a-z\-]*|update-zone\.logic\.ts','logic'),
 (r'.*','.'),
]
g_upd=section(T+'/zones/update','14.3',upd)
logs=[
 (r'use-logs-[a-z\-]+\.ts','hooks'),
 (r'logs-zone\.(list-keys|overlay-keys|pane-keys|rule-draft-keys|rule-list-keys|keys\.logic|editor-actions|pane-actions)\.ts','keys'),
 (r'log-filter-editor\.tsx|logs-zone\.filter[.a-z\-]*','filters'),
 (r'fullscreen-pane\.tsx|logs-(grid|pane-view|pane-views|service-lists|actions-menu)[.a-z\-]*|logs-zone\.(actions-menu|history-grid)\.test\.tsx','panes'),
 (r'logs-zone\.(logic|focus\.logic|health\.logic|layout\.logic)[.a-z]*','logic'),
 (r'.*','.'),
]
g_logs=section(T+'/zones/logs','14.3',logs)
rt=[
 (r'use-routes-[a-z\-]+\.ts','hooks'),
 (r'routes-zone\.[a-z\-]+-keys\.ts','keys'),
 (r'routes-(detail-pane|list-pane|modals|request-tab|response-tab|saved-tab)[.a-z]*|routes-zone\.(nodes|states)\.tsx','panes'),
 (r'routes-request\.logic[.a-z]*|routes-zone\.logic[.a-z]*','logic'),
 (r'routes-zone\.(json-tree|list|request|saved)\.test\.tsx','scenarios'),
 (r'.*','.'),
]
g_rt=section(T+'/zones/routes','14.3',rt)
ed=[
 (r'use-edts-[a-z\-]+\.ts','hooks'),
 (r'edts-(detail-column|list-column|dialog-views)\.tsx','views'),
 (r'edts-zone\.(logic|focus\.logic|format\.logic|dialogs\.logic|modify\.logic|wizard\.logic|dialog-seed)\.ts|edts-footer-context[.a-z]*','logic'),
 (r'edts-zone\.(create-from|create-validation|create-wizard|delete|modify|branch-conflicts|retry-and-branch-usage)\.test\.tsx','scenarios/lifecycle'),
 (r'bounded-rendering\.test\.tsx|edts-zone\.(activation|quick-pick|service-actions|switch|system-edt)\.test\.tsx','scenarios/runtime'),
 (r'.*','.'),
]
g_ed=section(T+'/zones/edts','14.3',ed)
# ---- dialogs/wizard
dl=[
 (r'(switch-dialog|switch-restart-report)[.a-z\-]*','switch'),
 (r'(add-to-edt-dialog|delete-dialog|modify-dialog|issues-dialog|branch-plan-table)[.a-z]*','edt'),
 (r'(fast-forward-dialog|quick-pick-dialog|service-actions-dialog)[.a-z\-]*','actions'),
]
g_dl=section(T+'/zones/edts/dialogs','14.5',dl)
wz=[
 (r'create-wizard\.tsx|wizard\.logic[.a-z]*','.'),
 (r'step-[a-z]+[.a-z]*|activation\.logic[.a-z]*','steps'),
 (r'override-box[.a-z]*','override-box'),
]
g_wz=section(T+'/zones/edts/dialogs/create-wizard','14.5',wz)
# ---- core
ce=[
 (r'(activate|create|delete|modify|list)(\.test)?\.ts','lifecycle'),
 (r'switch-restart[.a-z]*','switch/restart'),
 (r'switch[.a-z\-]*','switch'),
 (r'(branch-owners|checkout-expected|shared-branches|fast-forward-shared)[.a-z]*','branches'),
 (r'(shared-edt|manifest-carry|resolve-tab-visibility)[.a-z\-]*','shared-edt'),
]
g_ce=section('src/core/edt','14.4',ce)
cs=[
 (r'group-update\.[a-z\-.]+','group-update'),
 (r'(clean-registry|list-repos|register|scan|validate-registry)[.a-z]*','registry'),
 (r'reset[.\-a-z]*','reset'),
 (r'(run-pool|service-restart|resolve-merge-sources)[.a-z\-]*','update-support'),
]
g_cs=section('src/core/scripts','14.4',cs)
cp=[
 (r'(container|docker|health-probe|restart|shell-session|editor|lock|dev-auth)\.ts','runtime'),
 (r'(git|manifest|manifest-carry|migration)\.ts','vcs'),
 (r'(edt-registry|registry|saved-request|settings|state)(\.test)?\.ts','storage'),
 (r'(route-scanner|shared-types)\.ts','modules'),
]
g_cp=section('src/core/ports','14.4',cp)
cst=[
 (r'(publish-version|propagate-version|version-history)[.a-z]*','versioning'),
 (r'(list-consumers|resolve-conflict|smart-update)[.a-z]*','consumers'),
]
g_cst=section('src/core/shared-types','14.4',cst)
# ---- 14.5
gi=[
 (r'index\.ts|git\.port\.test\.ts|git\.test-support\.ts','.'),
 (r'(branches|refs|remote)\.ts|git\.(branches|remote)\.test\.ts','refs'),
 (r'(stash|discard|diff|commit|gate)\.ts|git\.(stash|gate|worktree-state)\.test\.ts','worktree'),
 (r'merge\.ts|git\.merge\.test\.ts|switch-manifest-carry\.integration\.test\.ts','merge'),
 (r'version-history[.a-z]*','history'),
]
g_gi=section('src/adapters/driven/git','14.5',gi)
cli=[
 (r'(dispatch|envelope)[.a-z\-]*','dispatch'),
 (r'.*','.'),
]
g_cli=section('src/adapters/driving/cli','14.5',cli)
clc=[
 (r'edt[.a-z\-]*','edt'),
 (r'.*','.'),
]
g_clc=section('src/adapters/driving/cli/commands','14.5',clc)
bn=[
 (r'e2e\.test-support\.ts|install-sh\.e2e\.test\.ts|tui-back\.e2e\.[a-z\-]+\.test\.ts','e2e'),
 (r'.*','.'),
]
g_bn=section('src/bin','14.5',bn)

# inventory
def sub(d):
    s=set()
    for f in files:
        if f.startswith(d+'/'):
            r=f[len(d)+1:]
            if '/' in r: s.add(r.split('/')[0])
    return len(s)
dirs=sorted(set(f.rsplit('/',1)[0] for f in files)|{d for f in files for d in [f.rsplit('/',1)[0]]})
alld=set()
for f in files:
    p=f.rsplit('/',1)[0]
    while True:
        alld.add(p)
        if '/' not in p: break
        p=p.rsplit('/',1)[0]
rows=[]
for d in sorted(alld):
    n=len(direct(d)); s=sub(d)
    if n>10 or s>10: rows.append((d,n,s))
pass
# emit
for t,d,st,g,nt in [
 ('', T+'/shared/components','14.2',g_comp,'Role-based. `json-tree/` (10 files) already exists and stays. `index.ts` is an existing barrel: only its internal `./x.js` paths change (not a new shim).'),
 ('', T+'/shared','14.2',g_sh,'`@components/pickers` = moves to `shared/components/pickers/` (it is imported by `branch-picker.tsx` and by the create-wizard). `poll/` (2 files: `in-flight-guard.ts`, `in-flight-guard.test.ts`) additionally moves into `shared/hooks/` (14.2) so `shared` ends at 10 subdirectories (screens, bounds, components, hooks, input-history, keys, scrollable-output, settings, test-support, theme).'),
 ('', T+'/shared/hooks','14.2',g_hk,'Not a split: listed to prove the `poll/` fold-in (5 existing + 2 moved = 7 files, no name collision: `in-flight-guard.ts`, `in-flight-guard.test.ts` do not exist in `hooks/`).'),
 ('', T+'/store/slices','14.3',g_sl,'One folder per domain. `update-slice.*` is 13 files, so it is split again by concern.'),
 ('', T+'/zones/update','14.3',g_upd,''),
 ('', T+'/zones/logs','14.3',g_logs,''),
 ('', T+'/zones/routes','14.3',g_rt,''),
 ('', T+'/zones/edts','14.3',g_ed,'`dialogs/` subtree is untouched by 14.3 (owned by 14.5). `scenarios/*` hold multi-component zone tests; they import `../../edts-zone.test-support.js`.'),
 ('', 'src/core/edt','14.4',g_ce,'Existing `switch/` (3 files: `dirty.ts`, `member.ts`, `types.ts`) stays and receives the `switch.*` files (10 in total).'),
 ('', 'src/core/scripts','14.4',g_cs,'Existing `group-update/` (10 files: `all.ts`, `blockers.ts`, `conflict.ts`, `edt.ts`, `member.ts`, `observers.ts`, `outcome.ts`, `restart.ts`, `selection.ts`, `types.ts`) moves down to `group-update/steps/` so that `group-update/` holds the orchestrator and its tests (10 files).'),
 ('', 'src/core/ports','14.4',g_cp,'**Ask First** (see section 5): file paths change, interface names do not.'),
 ('', 'src/core/shared-types','14.4',g_cst,''),
 ('', T+'/zones/edts/dialogs','14.5',g_dl,'Existing `switch-resolution/` (4 files) stays as a sibling.'),
 ('', T+'/zones/edts/dialogs/create-wizard','14.5',g_wz,''),
 ('', 'src/adapters/driven/git','14.5',g_gi,''),
 ('', 'src/adapters/driving/cli','14.5',g_cli,'`commands/` stays a sibling.'),
 ('', 'src/adapters/driving/cli/commands','14.5',g_clc,''),
 ('', 'src/bin','14.5',g_bn,'See section 5 for the two non-pure edits needed in the e2e files.'),
]:
    emit('',d,st,g,nt)
# drift/collision check: every git-tracked direct file counted, hooks collision
assert not set(direct(T+'/shared/hooks')) & set(direct(T+'/shared/poll'))
txt='\n'.join(out)
if OUT: open(OUT,'w').write(txt)
print('OK: all mapped, no drift')
