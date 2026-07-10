# ETAP 6 — nowy panel warstw mapy

Wersja: **19.37 - 1007260910**

## Zakres wykonanych zmian

1. Zastąpiono ogólny panel tekstowy dedykowanym panelem warstw wysuwanym od dołu ekranu.
2. Dodano trzy główne typy mapy prezentowane jako duże miniatury:
   - Domyślna — OpenStreetMap,
   - Satelita — Esri World Imagery z nazwami,
   - Teren — OpenTopoMap.
3. Zachowano trzy dodatkowe dotychczasowe podkłady:
   - Czytelna — OSM Humanitarian,
   - Jasna — CARTO,
   - Ulice — Esri World Street Map.
4. Aktywny podkład jest jednoznacznie zaznaczony obramowaniem i kolorem nazwy.
5. Zmiana podkładu następuje bez zamykania panelu, dzięki czemu można szybko porównać mapy.
6. Dodano sekcję „Szczegóły mapy”:
   - widoczność wcześniej obliczonego zasięgu RF,
   - widoczność wczytanej warstwy pokrycia GeoJSON/XYZ.
7. Zachowano obsługę zewnętrznej warstwy XYZ i importu GeoJSON; przeniesiono je do rozwijanej sekcji zaawansowanej.
8. Panel zamyka się przyciskiem ×, dotknięciem tła lub klawiszem Escape.
9. Dostosowano panel do telefonu, komputera i obszaru bezpiecznego ekranu.

## Zmienione pliki programu

- `index.html` — dedykowana struktura panelu warstw,
- `style.css` — układ, miniatury, animacja i wersja mobilna,
- `app.js` — otwieranie panelu, wybór podkładu i widoczność warstw,
- `service-worker.js` — nowa wersja pamięci podręcznej,
- `README.md` — opis etapu 6.

## Funkcje pozostawione bez zmian

Nie zmieniano GPS, automatycznej lokalizacji, centrowania i zoomu mapy, kompasu, północy, menu bocznego, listy nadajników, wyboru MUX, danych nadajników, obliczeń RF, profilu terenu, DEM ani plików ANT.

## Weryfikacja

- składnia `app.js` i `service-worker.js`: poprawna,
- pliki JSON: poprawne,
- identyfikatory HTML: unikalne,
- wszystkie sześć dotychczasowych podkładów nadal wywołuje istniejącą funkcję `setBase()`,
- warstwy dodatkowe są jedynie pokazywane lub ukrywane; ich obliczanie i dane nie zostały zmienione,
- pozostałe pliki projektu są identyczne jak w etapie 5.

Końcowy wygląd i gesty należy dodatkowo sprawdzić na fizycznym telefonie z Androidem.
