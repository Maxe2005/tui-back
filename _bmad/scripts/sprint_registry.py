#!/usr/bin/env python3
"""Multi-sprint registry for BMAD: resolve / list / new / activate / close.

Registry: {project-root}/_bmad-output/sprints/registry.json (stdlib only).
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
        "epics_range": s.get("epics"),
        "epics_file_exists": epics.exists(),
        "status_file_exists": (ROOT / s["status_file"]).exists(),
    }


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
    args = ap.parse_args()
    reg = load()

    if args.cmd == "resolve":
        out(view(find(reg, args.sprint or reg["active"]), reg["active"]))
    if args.cmd == "list":
        out({"ok": True, "active": reg["active"], "sprints": [view(s, reg["active"]) for s in reg["sprints"]]})
    if args.cmd == "next-epic":
        out({"ok": True, "next_epic_number": max_epic(reg) + 1})
    if args.cmd == "new":
        nums = [int(re.sub(r"\D", "", s["id"]) or 0) for s in reg["sprints"]]
        sid = f"sprint-{max(nums) + 1}"
        slug = re.sub(r"[^a-z0-9]+", "-", args.name.lower()).strip("-")[:50]
        d = Path("_bmad-output/sprints") / f"{sid}-{slug}"
        (ROOT / d).mkdir(parents=True, exist_ok=True)
        reg["sprints"].append({"id": sid, "name": args.name, "status": "planned",
                               "epics_file": str(d / "epics.md"), "status_file": str(d / "sprint-status.yaml"),
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
