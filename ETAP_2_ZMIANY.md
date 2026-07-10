# DVB-T/T2 Point — ETAP 2: lokalizacja i sterowanie mapą

## Wprowadzone zmiany

1. Przycisk GPS został przeniesiony do prawego dolnego rogu. Ma 58 × 58 px, niebieskie tło, czytelną ikonę i stany: pobieranie, sukces oraz błąd.
2. Po uruchomieniu aplikacji automatycznie wykonywana jest jednorazowa próba pobrania dokładnej lokalizacji.
3. Po poprawnym odczycie GPS mapa centruje się na użytkowniku i ustawia zoom 18.
4. Ponowne naciśnięcie przycisku GPS ponownie pobiera pozycję i wraca do użytkownika.
5. Wybór nadajnika nie używa już `fitBounds()` między użytkownikiem i nadajnikiem. Zachowany jest bieżący zoom, więc mapa nie oddala się samoczynnie.
6. Maksymalny zoom Leaflet został zwiększony z 18 do 22. Dla każdego podkładu ustawiono `maxNativeZoom`, aby ostatnie dostępne kafelki były bezpiecznie skalowane zamiast pobierania nieistniejących poziomów.
7. Kontrolki +/− na komputerze zostały przeniesione do lewego dolnego rogu, aby nie kolidowały z przyciskiem lokalizacji.
8. Przycisk GPS przesuwa się nad dolną kartę nadajnika, dzięki czemu pozostaje dostępny.

## Zakres etapu

Ten etap obejmuje punkty 1, 4, 5 i 6 listy wymagań. Kompas, usunięcie banera, nowe menu, MUX-y, książka referencyjna i panel warstw pozostają do kolejnych etapów.

## Testy statyczne

- składnia `app.js`,
- poprawność JSON,
- zgodność numerów wersji i cache Service Workera,
- test położenia przycisku lokalizacji na ekranie mobilnym 412 × 915 px w Chromium.

Pełne działanie GPS oraz pobieranie kafelków wymaga końcowego sprawdzenia na fizycznym telefonie z uruchomioną lokalizacją i dostępem HTTPS.
