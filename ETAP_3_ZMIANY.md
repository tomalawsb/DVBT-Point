# ETAP 3 — kompas i wskaźnik północy

Wersja: **19.34 - 1007260820**

## Zakres wykonanych zmian

1. Kierunek telefonu jest obliczany z absolutnego odczytu czujnika względem północy.
2. Uwzględniany jest obrót ekranu telefonu, aby wskazanie nie przesuwało się po zmianie orientacji urządzenia.
3. Względne odczyty `deviceorientation`, które mogą dryfować, nie są używane jako kierunek kompasowy.
4. Na urządzeniach obsługujących iOS używany jest `webkitCompassHeading`; na pozostałych preferowany jest `deviceorientationabsolute`.
5. Po zmianie orientacji ekranu filtr wskazań jest zerowany i synchronizowany z nowym układem ekranu.
6. Wskazówka telefonu, stożek na mapie oraz ikona **N** korzystają z tej samej skorygowanej wartości kierunku.
7. Ikona **N** jest przygaszona przed uzyskaniem poprawnego odczytu i aktywuje się po uruchomieniu kompasu.
8. Zachowano wygładzanie wskazań, ale usunięto powielone, bardzo szybkie próbki czujnika.
9. Doprecyzowano informacje w panelu kompasu i komunikaty o zgodzie na magnetometr.

## Pliki programu zmienione w tym etapie

- `app.js` — wyłącznie obsługa kompasu, kierunku, ikony N i numer wersji,
- `style.css` — wyłącznie stan aktywny/nieaktywny ikony N,
- `index.html` — opis dostępności ikony N oraz numer wersji plików,
- `service-worker.js` — wyłącznie nowy numer pamięci podręcznej,
- `README.md` — opis etapu 3.

## Funkcje pozostawione bez zmian

Nie zmieniano lokalizacji GPS, przycisku lokalizacji, przybliżania mapy, nadajników, multipleksów, obliczeń zasięgu RF, profilu terenu, warstw mapy, bazy danych ani pozostałych paneli aplikacji.

## Weryfikacja

- składnia aktywnego JavaScript: poprawna,
- składnia Service Workera: poprawna,
- pliki JSON: poprawne,
- lokalne zasoby pamięci podręcznej: kompletne,
- test obliczeń kierunku i przejścia przez 0/360°: poprawny,
- porównanie z etapem 2: zmieniono tylko pięć wskazanych plików programu.

Ostateczną dokładność kompasu należy sprawdzić na fizycznym telefonie z magnetometrem, najlepiej z dala od metalu, samochodu, masztu i magnesów.
