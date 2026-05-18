# DVB-T/T2 Point — 19.23 - 1805260658

Etap 19.23:
- przycisk „Sprawdź ANT wybranego nadajnika” działa tylko dla aktualnie wybranego nadajnika i jego MUX-ów,
- brakujące ANT są pobierane pojedynczo i zapisywane w cache przeglądarki,
- obliczanie RF korzysta z ANT zapisanych w cache,
- profil terenu ma siatkę, opisy osi, linię LOS, przeszkody i 60% strefy Fresnela,
- usunięto zdublowaną funkcję `showProfile()` z `app.js`,
- panel warstw ma jasne nazwy: zewnętrzna warstwa zasięgu XYZ albo GeoJSON,
- UI rozróżnia zasięg orientacyjny liczony przez aplikację od zewnętrznej mapy pokrycia.

Uwaga o zasięgu:
Zasięg RF/ITM-lite liczony przez aplikację jest orientacyjny. Prawdziwa mapa pokrycia wymaga osobnego, legalnego źródła GeoJSON/XYZ/API.

Uwaga o ANT:
Aplikacja HTML/JS nie zapisuje pobranych ANT jako fizycznych plików w folderze `data/ant`. Zapisuje je w cache przeglądarki. Fizyczne pliki `.ant` można nadal przygotować skryptem `download_ant_patterns.py`.

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


## Wersja 19.5

- Poprawiono numer wersji widoczny w interfejsie.
- Dodano dynamiczne ustawianie napisu wersji z jednej stałej `APP_VERSION`.
- Zmieniono cache service workera, aby przeglądarka nie trzymała starego `index.html`.
- Zmieniono parametry `?v=` przy `app.js` i `style.css`, aby wymusić odświeżenie plików.
