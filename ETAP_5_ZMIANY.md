# ETAP 5 — nadajniki oraz wybór multipleksu

Wersja: **19.36 - 1007260843**

## Zakres wykonanych zmian

1. W karcie wybranego nadajnika, bezpośrednio przy jego nazwie, dodano listę `Multipleks i kanał`.
2. Każda pozycja listy pokazuje:
   - nazwę MUX,
   - kanał,
   - częstotliwość,
   - moc ERP.
3. Po zmianie MUX natychmiast aktualizują się:
   - polaryzacja,
   - moc ERP,
   - pomarańczowy okrąg zasięgu orientacyjnego.
4. Po dotknięciu okręgu zasięgu widoczna jest informacja, dla którego MUX został pokazany.
5. Obliczanie zasięgu RF wykorzystuje parametry wybranego MUX zamiast automatycznie wybierać emisję o największej mocy.
6. Profil terenu i strefa Fresnela wykorzystują częstotliwość wybranego MUX.
7. Wybrany MUX jest zapisywany w ustawieniach lokalnych aplikacji.
8. Jeżeli po zmianie MUX był widoczny wcześniej obliczony zasięg RF, jest usuwany, aby nie przedstawiał wyniku dla poprzedniego MUX.
9. Usunięto automatyczne ustawianie fokusu na polu wyszukiwania nadajników. Klawiatura telefonu otwiera się dopiero po ręcznym dotknięciu pola „Szukaj”.

## Zmienione pliki programu

- `index.html` — lista wyboru MUX przy nazwie nadajnika,
- `style.css` — wygląd listy MUX,
- `app.js` — wybór MUX, aktualizacja zasięgu i brak automatycznego fokusu,
- `service-worker.js` — nowa wersja pamięci podręcznej,
- `README.md` — opis etapu 5.

## Funkcje pozostawione bez zmian

Nie zmieniano GPS, automatycznej lokalizacji, centrowania i zoomu mapy, kompasu, wskaźnika północy, menu bocznego, warstw mapy, bazy nadajników, danych DEM ani obsługi plików ANT.

## Weryfikacja

- składnia `app.js` i `service-worker.js`: poprawna,
- pliki JSON: poprawne,
- identyfikatory HTML: unikalne,
- lista MUX jest wypełniana po wyborze nadajnika,
- zmiana MUX aktualizuje zapisany wybór,
- lista nadajników otwiera się bez wymuszonego `focus()` pola wyszukiwania,
- pliki danych, grafiki, skrypty importu oraz kopie starszego kodu są identyczne jak w etapie 4.

Dokładne zachowanie klawiatury ekranowej i wygląd listy należy końcowo sprawdzić na fizycznym telefonie z Androidem.
