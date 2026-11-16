#!/usr/bin/env python3
"""Multi-sprint registry for BMAD: resolve / list / new / activate / close / check.

Registry: {project-root}/_bmad-output/sprints/registry.json (stdlib only).
Layout (one folder per sprint, same name in both trees):
  _bmad-output/sprints/<sprint>/                      epics.md + sprint-change-proposal-*.md   (+ registry.json one level up)
  _bmad-output/implementation-artifacts/<sprint>/     epic-N/ (story specs), epic-N-context.md, sprint-status.yaml(+archive)
  _bmad-output/implementation-artifacts/deferred-work.md   (shared, sprint-agnostic)
Epic numbers stay GLOBAL across sprints (sprint 2 continues after sprint 1's last epic),
so story keys, story files, branch names and retro keys never collide.
Every command prints JSON on stdout. Exit 1 + {"ok": false, "error": ...} on failure.
"""
import argparse, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REG = ROOT / "_bmad-output" / "sprints" / "registry.json"
EPIC_RE = re.compile(r"^##\s+Epic\s+(\d+)\s*:", re.M)


def out(obj, code=0):
    print(json.dumps(obj, ensure_ascii=False, indent=2))
    sys.exit(code)


def fail(msg):
    out({"ok": False, "error": msg}, 1)


def load():
    if not REG.exists():
        fail(f"registry not found: {REG}")
    return json.loads(REG.read_text())


def save(reg):
    REG.write_text(json.dumps(reg, ensure_ascii=False, indent=2) + "\n")


def find(reg, sid):
    for s in reg["sprints"]:
        if s["id"] == sid:
            return s
    fail(f"unknown sprint: {sid}")


def view(s, active):
    epics = ROOT / s["epics_file"]
    return {
        "ok": True, "sprint_id": s["id"], "name": s["name"], "status": s["status"],
        "is_active": s["id"] == active,
        "epics_file": str(epics), "status_file": str(ROOT / s["status_file"]),
        "sprint_dir": str(epics.parent), "artifacts_dir": str(ROOT / s["artifacts_dir"]),
        "epics_range": s.get("epics"),
        "epics_file_exists": epics.exists(),
        "status_file_exists": (ROOT / s["status_file"]).exists(),
    }


def check(reg):
    """Validate the on-disk layout against the registry; returns a list of problems."""
    ia, sp, pa = ROOT / "_bmad-output" / "implementation-artifacts", ROOT / "_bmad-output" / "sprints", ROOT / "_bmad-output" / "planning-artifacts"
    probs, sprint_dirs = [], set()
    for s in reg["sprints"]:
        e, a, st = ROOT / s["epics_file"], ROOT / s["artifacts_dir"], ROOT / s["status_file"]
        sprint_dirs.add(e.parent.name)
        if e.parent.name != a.name:
            probs.append(f"{s['id']}: sprint folder names differ ({e.parent.name} vs {a.name})")
        if e.parent.parent != sp or a.parent != ia:
            probs.append(f"{s['id']}: epics_file/artifacts_dir not at _bmad-output/sprints/<sprint>/ and implementation-artifacts/<sprint>/")
        if st.parent != a:
            probs.append(f"{s['id']}: status_file must live in artifacts_dir")
        for f, label in ((e, "epics_file"), (st, "status_file")):
            if not f.exists():
                probs.append(f"{s['id']}: missing {label} {f.relative_to(ROOT)}")
        for c in a.glob("epic-*") if a.exists() else []:
            if not re.fullmatch(r"epic-\d+(-context\.md)?", c.name):
                probs.append(f"{c.relative_to(ROOT)}: unexpected name (expected epic-N/ or epic-N-context.md)")
        for c in sorted(a.glob("epic-*/*")) if a.exists() else []:
            pass
    for c in sorted(ia.iterdir()) if ia.exists() else []:
        if c.name != "deferred-work.md" and c.name not in sprint_dirs:
            probs.append(f"{c.relative_to(ROOT)}: not allowed at implementation-artifacts root (only deferred-work.md + one folder per sprint)")
    for c in sorted(sp.iterdir()) if sp.exists() else []:
        if c.name != "registry.json" and c.name not in sprint_dirs:
            probs.append(f"{c.relative_to(ROOT)}: not allowed at sprints root (only registry.json + one folder per sprint)")
    for s in reg["sprints"]:
        d = (ROOT / s["epics_file"]).parent
        for c in sorted(d.iterdir()) if d.exists() else []:
            if c.name != "epics.md" and not re.fullmatch(r"sprint-change-proposal-.+\.md", c.name):
                probs.append(f"{c.relative_to(ROOT)}: sprint folder holds only epics.md + sprint-change-proposal-*.md")
        a = ROOT / s["artifacts_dir"]
        for c in sorted(a.iterdir()) if a.exists() else []:
            if not (c.name in ("sprint-status.yaml", "sprint-status-archive.yaml", "no-epic") or re.fullmatch(r"epic-\d+(-context\.md)?", c.name)):
                probs.append(f"{c.relative_to(ROOT)}: unexpected entry in a sprint's implementation folder")
    for stray in sorted(pa.glob("sprint-change-proposal-*.md")) + sorted(pa.glob("epics*.md")):
        probs.append(f"{stray.relative_to(ROOT)}: belongs in its sprint folder under _bmad-output/sprints/")
    return probs


def max_epic(reg):
    n = 0
    for s in reg["sprints"]:
        p = ROOT / s["epics_file"]
        if p.exists():
            nums = [int(m) for m in EPIC_RE.findall(p.read_text())]
            n = max([n] + nums)
    return n


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("resolve"); r.add_argument("--sprint")
    sub.add_parser("list")
    n = sub.add_parser("new"); n.add_argument("--name", required=True); n.add_argument("--no-activate", action="store_true")
    a = sub.add_parser("activate"); a.add_argument("sprint")
    c = sub.add_parser("close"); c.add_argument("sprint")
    sub.add_parser("next-epic")
    sub.add_parser("check")
    args = ap.parse_args()
    reg = load()

    if args.cmd == "resolve":
        out(view(find(reg, args.sprint or reg["active"]), reg["active"]))
    if args.cmd == "list":
        out({"ok": True, "active": reg["active"], "sprints": [view(s, reg["active"]) for s in reg["sprints"]]})
    if args.cmd == "check":
        probs = check(reg)
        out({"ok": not probs, "problems": probs}, 1 if probs else 0)
    if args.cmd == "next-epic":
        out({"ok": True, "next_epic_number": max_epic(reg) + 1})
    if args.cmd == "new":
        nums = [int(re.sub(r"\D", "", s["id"]) or 0) for s in reg["sprints"]]
        sid = f"sprint-{max(nums) + 1}"
        slug = re.sub(r"[^a-z0-9]+", "-", args.name.lower()).strip("-")[:50]
        d = Path("_bmad-output/sprints") / f"{sid}-{slug}"            # epics.md + sprint change proposals
        a = Path("_bmad-output/implementation-artifacts") / f"{sid}-{slug}"  # epic-N/ specs, epic contexts, sprint-status
        (ROOT / d).mkdir(parents=True, exist_ok=True)
        (ROOT / a).mkdir(parents=True, exist_ok=True)
        reg["sprints"].append({"id": sid, "name": args.name, "status": "planned",
                               "epics_file": str(d / "epics.md"), "artifacts_dir": str(a),
                               "status_file": str(a / "sprint-status.yaml"),
                               "epics": f"{max_epic(reg) + 1}-"})
        if not args.no_activate:
            reg["active"] = sid
            find(reg, sid)["status"] = "active"
        save(reg)
        out(view(find(reg, sid), reg["active"]) | {"next_epic_number": max_epic(reg) + 1})
    if args.cmd == "activate":
        find(reg, args.sprint); reg["active"] = args.sprint
        s = find(reg, args.sprint)
        if s["status"] in ("planned", "closed"):
            s["status"] = "active"
        save(reg); out(view(s, reg["active"]))
    if args.cmd == "close":
        s = find(reg, args.sprint); s["status"] = "closed"
        if reg["active"] == args.sprint:
            reg["active"] = None
        save(reg); out({"ok": True, "closed": args.sprint, "active": reg["active"],
                        "hint": "run `activate <id>` to pick the next active sprint"})


if __name__ == "__main__":
    main()
