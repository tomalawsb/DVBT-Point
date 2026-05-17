#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pobiera pliki charakterystyki anten ANT z linków RadioPolska zapisanych w data/ant/index.json.
Nie wymaga zewnętrznych bibliotek.

Uruchomienie:
    python download_ant_patterns.py

Opcjonalnie:
    python download_ant_patterns.py --limit 20
    python download_ant_patterns.py --include-invalid
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INDEX_PATH = ROOT / "data" / "ant" / "index.json"
USER_AGENT = "DVB-T-T2-Point/19.4 local ANT downloader; source attribution: RadioPolska.pl"


def load_index() -> dict:
    if not INDEX_PATH.exists():
        raise FileNotFoundError(f"Brak pliku indeksu: {INDEX_PATH}")
    with INDEX_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_index(data: dict) -> None:
    items = data.get("items", [])
    data["downloaded_count"] = sum(1 for item in items if item.get("downloaded"))
    with INDEX_PATH.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def safe_url(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(parts.path, safe="/%")
    query = urllib.parse.quote(parts.query, safe="=&%")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


def download_one(url: str, out_path: Path, timeout: int = 30) -> tuple[bool, str]:
    req = urllib.request.Request(safe_url(url), headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status != 200:
                return False, f"HTTP {status}"
            content = response.read()
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, str(e)

    if len(content) < 10:
        return False, "Pobrany plik jest podejrzanie mały"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(content)
    return True, f"OK, {len(content)} B"


def main() -> int:
    parser = argparse.ArgumentParser(description="Pobieranie plików ANT RadioPolska do lokalnego katalogu data/ant")
    parser.add_argument("--limit", type=int, default=0, help="Maksymalna liczba plików do pobrania w tym uruchomieniu")
    parser.add_argument("--delay", type=float, default=0.35, help="Przerwa między pobraniami, aby nie obciążać serwera")
    parser.add_argument("--include-invalid", action="store_true", help="Próbuj pobierać także linki bez prawidłowego ID ANT")
    args = parser.parse_args()

    data = load_index()
    items = data.get("items", [])
    done_now = 0
    tried_now = 0

    for item in items:
        if args.limit and tried_now >= args.limit:
            break
        if item.get("downloaded"):
            continue
        if not args.include_invalid and not item.get("ant_file_id"):
            item["note"] = item.get("note") or "Pominięto: brak prawidłowego ID ANT w URL."
            continue

        url = item.get("url", "")
        local_path = ROOT / item.get("local_path", "")
        print(f"Pobieram: {url}")
        tried_now += 1
        ok, note = download_one(url, local_path)
        item["downloaded"] = bool(ok)
        item["note"] = note
        if ok:
            done_now += 1
        print("  ->", note)
        save_index(data)
        time.sleep(args.delay)

    save_index(data)
    print(f"Gotowe. Próbowano: {tried_now}. Pobrano w tym uruchomieniu: {done_now}. Łącznie pobrane: {data.get('downloaded_count', 0)} / {len(items)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
