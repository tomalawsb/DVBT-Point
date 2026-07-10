# Etap 8 — testy końcowe

Wydanie kontrolne: **19.39 - 1007260932**.

## Zakres

Etap nie zmienia działania mapy, GPS, kompasu, nadajników, MUX-ów, RF, profilu terenu, DEM ani książki referencyjnej. Zmieniono wyłącznie numer wydania, identyfikator cache PWA i dokumentację testową.

## Wyniki testów

### 1. Kontrola statyczna — 38/38 zaliczonych

- składnia `app.js`, `js/app.js`, `service-worker.js` i kopii zapasowej,
- poprawność wszystkich plików JSON,
- unikalność identyfikatorów HTML,
- obecność zasobów wskazanych przez `index.html`, manifest i cache PWA,
- spójność numeru wersji,
- integralność bazy 274 nadajników,
- obecność kluczowych mechanizmów GPS, zoomu 22, menu, MUX i kompasu.

### 2. Scenariusz funkcjonalny telefonu — 23/23 zaliczone

Sprawdzono przy rozdzielczości **390 × 844 px**:

- start aplikacji i inicjalizację mapy,
- brak banera „Czekam na czujnik”,
- automatyczne pobranie lokalizacji i centrowanie z zoomem 18,
- ręczny przycisk lokalizacji,
- menu boczne, ustawienia, pomoc i książkę referencyjną,
- wyszukiwanie w książce oraz otwieranie działu MER,
- panel warstw i zmianę podkładu,
- listę nadajników bez automatycznego uruchamiania klawiatury,
- kartę nadajnika oraz listę MUX,
- reakcję ikony N na absolutny odczyt kierunku,
- brak błędów JavaScript w wykonanym scenariuszu.

### 3. Różne rozdzielczości — 36/36 zaliczonych

Sprawdzone widoki:

- 360 × 740 px,
- 390 × 844 px,
- 768 × 1024 px,
- 1366 × 768 px.

Na każdym widoku potwierdzono brak poziomego przewijania, widoczność głównych przycisków, poprawne położenie lokalizacji oraz mieszczenie się menu bocznego i panelu warstw na ekranie.

## Podsumowanie

Łącznie zaliczono **97 z 97 automatycznych kontroli**.

Testy przeglądarkowe używały kontrolowanych danych lokalizacji, kierunku i zastępczego środowiska mapowego, aby wynik nie zależał od internetu. Dokładność fizycznego magnetometru, GPS i zachowanie kafelków mapy trzeba ostatecznie sprawdzić na rzeczywistym telefonie z Androidem.
