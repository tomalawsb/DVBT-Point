#!/usr/bin/env python3
"""
Konwerter prostego CSV do data/transmitters.json.
CSV musi mieć nagłówki zgodne z data/transmitters-template.csv.
Użycie:
  python tools/convert_csv_to_transmitters.py wejscie.csv data/transmitters.json
"""
import csv
import json
import re
import sys
from pathlib import Path
from unicodedata import normalize


def slug(value: str) -> str:
    value = normalize("NFD", value or "").encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return value or "nadajnik"


def num(value, default=0.0):
    try:
        return float(str(value).replace(",", "."))
    except Exception:
        return default


def infer_band(freq):
    if 174 <= freq <= 230:
        return "VHF"
    if 470 <= freq <= 694:
        return "UHF"
    return "?"


def convert(rows):
    grouped = {}
    for row in rows:
        name = row.get("name") or row.get("nazwa") or row.get("site") or row.get("obiekt")
        lat = num(row.get("lat"))
        lon = num(row.get("lon") or row.get("lng"))
        mux = (row.get("mux") or row.get("multipleks") or "").strip()
        if not name or not lat or not lon or not mux:
            continue
        key = f"{slug(name)}-{lat:.5f}-{lon:.5f}"
        if key not in grouped:
            grouped[key] = {
                "id": key,
                "name": name,
                "site": row.get("site") or row.get("obiekt") or name,
                "lat": lat,
                "lon": lon,
                "height_m": num(row.get("height_m") or row.get("wysokosc_terenu_m")),
                "mast_m": num(row.get("mast_m") or row.get("wysokosc_masztu_m"), 80),
                "region": row.get("region") or row.get("wojewodztwo") or "",
                "source": row.get("source") or row.get("zrodlo") or "CSV",
                "muxes": [],
            }
        freq = num(row.get("frequency_mhz") or row.get("czestotliwosc_mhz"))
        grouped[key]["muxes"].append({
            "mux": mux,
            "channel": row.get("channel") or row.get("kanal") or "",
            "frequency_mhz": freq,
            "erp_kw": num(row.get("erp_kw") or row.get("erp") or row.get("moc_kw")),
            "polarization": (row.get("polarization") or row.get("polaryzacja") or "?").upper(),
            "band": row.get("band") or row.get("pasmo") or infer_band(freq),
        })
    return list(grouped.values())


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(2)
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    with src.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    data = convert(rows)
    dst.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Zapisano {len(data)} obiektów do {dst}")


if __name__ == "__main__":
    main()
