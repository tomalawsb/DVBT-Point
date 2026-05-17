# DVB-T/T2 Point — 19.1 - 1705261458

Etap 19:
- numer wersji widoczny stale na ekranie,
- czujnik kierunku uruchamiany automatycznie; bez przycisku włącz/wyłącz,
- stożek kierunku utrzymany nad warstwami mapy,
- profil terenu pozostaje realny z Open-Meteo Elevation API, bez profilu demo,
- aplikacja nie pokazuje udawanych zasięgów jako prawdziwych,
- dodany import prawdziwej warstwy zasięgu GeoJSON oraz opcja licencjonowanego URL kafelków XYZ.

Uwaga o zasięgu:
Gotowe, prawdziwe mapy pokrycia masztów wymagają legalnego źródła warstwy, np. GeoJSON/XYZ/API. Publiczne darmowe źródła pozwalają pozyskać parametry nadajników i dane wysokościowe, ale nie znalazłem oficjalnego publicznego darmowego API RadioPolska/Emitel do pobierania gotowych map pokrycia.

## Wersja 19.3

Baza nadajników została przebudowana z eksportu RadioPolska:
- 587 emisji,
- 274 obiekty nadawcze,
- dane pogrupowane po współrzędnych,
- dodane parametry MUX, ERP, polaryzacji, wysokości anten i linki ANT.

Konwerter: `build_transmitters_from_radiopolska.py`.

## Wersja 19.4

Dodano obsługę plików ANT RadioPolska:
- indeks data/ant/index.json,
- downloader download_ant_patterns.py,
- lokalne ścieżki ant_pattern_path w data/transmitters.json,
- parser ANT w app.js,
- korektę kierunkową anteny w obliczeniach RF, jeśli plik ANT został pobrany.

Pliki ANT pobierzesz komendą:

python download_ant_patterns.py

