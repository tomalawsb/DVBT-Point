# ETAP 7 — książka referencyjna

Wersja: **19.38 - 1007260917**

## Zakres wykonanych zmian

1. Dodano do wysuwanego menu bocznego nową pozycję „Książka referencyjna”.
2. Dodano osobny, pełnoekranowy na telefonie tryb panelu referencyjnego.
3. Dodano spis treści z dziewięcioma działami oraz wyszukiwarką zagadnień.
4. Dodano raster kanałów DVB-T/T2:
   - VHF-III, kanały 5–12, raster 7 MHz,
   - UHF, kanały 21–69, raster 8 MHz.
5. Dodano raster bloków DAB/DAB+ w paśmie VHF-III.
6. Dodano tabele wartości referencyjnych:
   - minimalne i maksymalne poziomy sygnału,
   - maksymalne różnice poziomów,
   - tłumienność wzajemna gniazd TV i radio,
   - minimalne SNR dla modulacji i FEC oraz przeliczenie CNR/SNR.
7. Dodano osobne działy MER i BER z najważniejszymi wartościami granicznymi.
8. Dodano dział konstelacji z czterema własnymi diagramami SVG:
   - sygnał prawidłowy,
   - błędy fazowe,
   - błędy amplitudy,
   - szum i zakłócenia.
9. Dodano przycisk „Spis treści” na każdej stronie działu.
10. Dostosowano tabele i diagramy do telefonu, komputera oraz obszaru bezpiecznego ekranu.
11. Diagramy i dane książki działają offline i nie korzystają z zewnętrznych obrazów ani API.

## Zmienione pliki programu

- `index.html` — pozycja książki referencyjnej w menu,
- `app.js` — spis treści, wyszukiwanie, tabele i diagramy,
- `style.css` — wygląd książki, tabel i konstelacji,
- `service-worker.js` — nowa wersja pamięci podręcznej,
- `README.md` — opis etapu 7.

## Funkcje pozostawione bez zmian

Nie zmieniano GPS, automatycznej lokalizacji, centrowania i zoomu mapy, kompasu, północy, listy nadajników, wyboru MUX, danych nadajników, obliczeń RF, profilu terenu, DEM, plików ANT ani panelu warstw mapy.

## Weryfikacja

- składnia `app.js`: poprawna,
- pliki JSON: poprawne,
- pozycja książki jest poprawnie powiązana z menu bocznym,
- spis treści wyświetla 9 działów,
- tabela SNR zawiera 15 pozycji,
- dział konstelacji wyświetla 4 diagramy SVG,
- przetestowano przejście ze spisu treści do działu i powrót,
- pozostałe dane projektu są identyczne jak w etapie 6.

Końcowy wygląd, przewijanie i czytelność należy dodatkowo sprawdzić na fizycznym telefonie z Androidem.
