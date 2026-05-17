#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Diagnostyka lokalnych plików ANT dla DVB-T/T2 Point 19.6.
Uruchom w katalogu aplikacji po pobraniu plików komendą:
    python download_ant_patterns.py
    python validate_ant_patterns.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / "data" / "ant" / "index.json"
REPORT = ROOT / "data" / "ant" / "diagnostics_report.json"


def norm_deg(value: float) -> float:
    return value % 360.0


def analyze_ant_text(text: str) -> dict:
    points = []
    for line in text.splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or clean.startswith(";"):
            continue
        nums = re.findall(r"-?\d+(?:[\.,]\d+)?", clean)
        if len(nums) < 2:
            continue
        try:
            az = float(nums[0].replace(",", "."))
            val = float(nums[1].replace(",", "."))
        except ValueError:
            continue
        if not (0 <= az <= 360):
            continue
        if not (-80 <= val <= 80):
            continue
        points.append((norm_deg(az), val))

    unique = sorted({round(p[0]) for p in points})
    ok = len(points) >= 8
    approx_full = bool(unique) and (len(unique) >= 180 or (len(unique) >= 24 and min(unique) <= 5 and max(unique) >= 355))
    return {
        "ok": ok,
        "points": len(points),
        "unique_azimuths": len(unique),
        "min_az": min(unique) if unique else None,
        "max_az": max(unique) if unique else None,
        "approx_full_360": approx_full,
    }


def main() -> int:
    if not INDEX.exists():
        print(f"Brak indeksu: {INDEX}")
        return 2

    data = json.loads(INDEX.read_text(encoding="utf-8"))
    items = data.get("items", [])
    summary = {
        "index_items": len(items),
        "with_url": 0,
        "local_existing": 0,
        "local_missing": 0,
        "parser_ok": 0,
        "parser_bad": 0,
        "full_360": 0,
        "partial": 0,
    }
    missing = []
    bad = []
    checked = []

    for item in items:
        if item.get("url"):
            summary["with_url"] += 1
        local = item.get("local_path")
        if not local:
            continue
        path = ROOT / local
        if not path.exists():
            summary["local_missing"] += 1
            if len(missing) < 100:
                missing.append(local)
            continue
        summary["local_existing"] += 1
        analysis = analyze_ant_text(path.read_text(encoding="utf-8", errors="replace"))
        checked.append({"local_path": local, **analysis})
        if analysis["ok"]:
            summary["parser_ok"] += 1
            if analysis["approx_full_360"]:
                summary["full_360"] += 1
            else:
                summary["partial"] += 1
        else:
            summary["parser_bad"] += 1
            if len(bad) < 100:
                bad.append({"local_path": local, **analysis})

    report = {"version": "19.6 - 1705261625", "summary": summary, "missing_first_100": missing, "bad_first_100": bad, "checked": checked}
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("Diagnostyka ANT zakończona.")
    print(f"Indeks: {summary['index_items']}")
    print(f"Pliki lokalne: {summary['local_existing']} / {summary['index_items']}")
    print(f"Parser OK: {summary['parser_ok']}")
    print(f"Błędne formaty: {summary['parser_bad']}")
    print(f"Pełne/prawie pełne 360°: {summary['full_360']}")
    print(f"Raport zapisany: {REPORT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
