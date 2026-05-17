# DVB-T/T2 Mapa Instalatora — Etap 12

Wersja: **12.0 - 1705260918**

Etap 12 to przebudowa interfejsu po teście na telefonie i komputerze. Nie dodaje jeszcze oficjalnych danych pokrycia — skupia się na naprawie czytelności, responsywności i ładowania mapy.

## Co poprawiono

- mapa ustawiona jako prawdziwy pełnoekranowy element `100dvh / 100vw`,
- dodane wymuszone `invalidateSize()` dla Leaflet po starcie, zmianie orientacji, powrocie do karty i zmianie viewportu,
- domyślnie używana stabilniejsza **Mapa standardowa** zamiast ciężkich warstw,
- stare ustawienie ciężkiej mapy z poprzedniej wersji nie jest automatycznie przejmowane,
- kafelki mapy mają lżejsze opcje ładowania: `updateWhenIdle`, `keepBuffer: 1`, bez animacji fade,
- panele są mniejsze, niższe i mniej „napuchnięte”,
- czcionki są lżejsze i mniejsze,
- panel boczny na telefonie wysuwa się od dołu i nie zasłania całego ekranu,
- kliknięcie mapy przy otwartym panelu najpierw zamyka panel,
- dolny panel przy otwartym aplecie zwija się do małego paska,
- przyciski pływające są mniejsze i bardziej przezroczyste,
- zmniejszone marginesy, zaokrąglenia i cienie,
- poprawiony układ chipów na małym ekranie,
- poprawiony cache PWA do wersji 12.

## Ważne

Dane nadajników nadal mogą być demonstracyjne, chyba że zaimportujesz własną bazę przez panel **PWA / Offline**.

Pokrycie nadal jest orientacyjne. Prawdziwe pokrycie wymaga oficjalnych/licencjonowanych warstw albo własnego generatora propagacji.

## Po wrzuceniu na GitHub Pages

Na telefonie zrób najlepiej:

1. Otwórz stronę.
2. Odśwież ją dwa razy.
3. Wejdź w menu przeglądarki i wybierz **Dodaj do ekranu głównego / Zainstaluj aplikację**.
4. Jeśli dalej widzisz stary wygląd, kliknij w aplikacji **PWA → Wymuś aktualizację aplikacji**.
5. Gdyby nadal trzymało starą wersję, w Chrome wyczyść dane witryny dla `tomalawsb.github.io`.

## Struktura

- `index.html`
- `css/style.css`
- `js/app.js`
- `data/transmitters.json`
- `data/sources.json`
- `data/transmitters-template.csv`
- `manifest.json`
- `service-worker.js`
- `assets/icon.svg`
- `tools/convert_csv_to_transmitters.py`
