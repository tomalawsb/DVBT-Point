# ETAP 4 — przebudowa interfejsu i menu boczne

Wersja: **19.35 - 1007260831**

## Zakres wykonanych zmian

1. Usunięto z głównego widoku cały baner „Czekam na czujnik”.
2. Dodano pływającą ikonę trzech poziomych kresek w lewym górnym rogu.
3. Po jej naciśnięciu wysuwa się pełnowysokościowy panel boczny z lewej strony.
4. Panel ma przyciemnione tło, przycisk zamknięcia oraz zamykanie klawiszem `Esc`.
5. Do menu przeniesiono:
   - ustawienia aplikacji,
   - pomoc i instrukcję.
6. Z głównego interfejsu usunięto osobne ikony:
   - koła zębatego,
   - pytajnika.
7. Aby nie utracić dostępu po usunięciu banera, w menu dodano skrót do panelu kompasu.
8. W menu dodano również skróty do istniejących paneli nadajników i warstw — ich działanie nie zostało zmienione.
9. Pole wyszukiwania przesunięto w prawo, aby nie nachodziło na przycisk menu.

## Pliki programu zmienione w tym etapie

- `index.html` — przycisk menu, panel boczny, usunięcie banera oraz ikon ustawień/pomocy,
- `style.css` — wygląd i animacja menu bocznego oraz układ górnego paska,
- `app.js` — wyłącznie obsługa otwierania/zamykania menu i podpięcie istniejących paneli,
- `service-worker.js` — nowy numer pamięci podręcznej,
- `README.md` — opis etapu 4.

## Funkcje pozostawione bez zmian

Nie zmieniano obliczeń GPS, centrowania i zoomu mapy, algorytmu kompasu, wskaźnika północy, wyboru nadajników, danych MUX, obliczeń zasięgu RF, profilu terenu, DEM, plików ANT ani warstw mapy.

## Weryfikacja

- składnia aktywnego JavaScript: poprawna,
- składnia Service Workera: poprawna,
- pliki JSON: poprawne,
- wszystkie zasoby wpisane do pamięci podręcznej istnieją,
- wszystkie identyfikatory HTML są unikalne,
- wymagane elementy menu oraz ich powiązania JavaScript są obecne,
- baner kompasu oraz osobne ikony ustawień/pomocy nie występują w głównym interfejsie,
- wszystkie pliki danych i pozostałe funkcje programu są identyczne z etapem 3.
