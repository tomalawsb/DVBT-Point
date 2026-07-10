# DVB-T/T2 Point — 19.39 - 1007260932


## Etap 8 — testy końcowe i wydanie kontrolne

- wykonano kontrolę składni JavaScript, poprawności JSON, spójności plików PWA i unikalności identyfikatorów HTML,
- wykonano automatyczny scenariusz interfejsu mobilnego: start, automatyczny GPS, ręczna lokalizacja, menu boczne, warstwy, lista nadajników, wybór MUX, książka referencyjna i reakcja ikony N,
- sprawdzono rozmieszczenie głównych kontrolek przy rozdzielczości telefonu 390 × 844 px,
- nie wprowadzano zmian w obliczeniach RF, danych nadajników, profilu terenu, DEM ani algorytmie kompasu,
- zmieniono wyłącznie numer wydania i cache PWA oraz dodano raport testów.

Pełny raport: `ETAP_8_TESTY.md`.


## Etap 7 — książka referencyjna

- do menu bocznego dodano pozycję „Książka referencyjna”,
- dodano spis treści z wyszukiwarką działów,
- książka zawiera raster kanałów DVB-T/T2 w VHF i UHF, raster DAB/DAB+, minimalne poziomy sygnału, dopuszczalne różnice poziomów, tłumienność wzajemną gniazd, SNR/CNR, MER, BER oraz przykłady konstelacji,
- tabele są przewijane poziomo na małych ekranach i zachowują czytelny nagłówek,
- dział konstelacji zawiera własne diagramy SVG działające offline, bez zewnętrznych obrazów,
- na każdej stronie działu jest przycisk powrotu do spisu treści,
- GPS, mapa, kompas, nadajniki, MUX-y, zasięg RF, profil terenu, DEM i warstwy mapy nie zostały zmienione.

## Etap 6 — nowy panel warstw mapy

- dotychczasową tekstową listę podkładów zastąpiono dedykowanym panelem wysuwanym od dołu,
- panel ma układ wzorowany na nowoczesnych aplikacjach mapowych: miniatury, nazwy i wyraźne zaznaczenie aktywnego podkładu,
- główne typy mapy to: Domyślna, Satelita i Teren,
- zachowano także dotychczasowe podkłady: Czytelna, Jasna i Ulice,
- dodano sekcję „Szczegóły mapy” do pokazywania lub ukrywania obliczonego zasięgu RF i wczytanej zewnętrznej mapy zasięgu,
- import GeoJSON oraz warstwa XYZ pozostały dostępne w rozwijanej sekcji zaawansowanej,
- panel można zamknąć krzyżykiem, dotknięciem przyciemnionego tła albo klawiszem Escape,
- obliczenia, GPS, kompas, nadajniki, MUX-y i pozostałe funkcje nie zostały zmienione.

## Etap 5 — nadajnik i wybór konkretnego MUX

- przy nazwie wybranego nadajnika dodano listę jego multipleksów,
- lista pokazuje nazwę MUX, kanał, częstotliwość i moc ERP,
- pomarańczowy zasięg orientacyjny jest liczony dla aktualnie wybranego MUX,
- polaryzacja i moc ERP na karcie nadajnika dotyczą wybranego MUX,
- obliczanie zasięgu RF i strefy Fresnela korzysta z wybranego MUX,
- wybór MUX jest zapamiętywany po ponownym uruchomieniu aplikacji,
- po otwarciu listy nadajników klawiatura nie uruchamia się automatycznie; pojawia się dopiero po dotknięciu pola wyszukiwania,
- pozostałe funkcje aplikacji nie zostały zmienione.

## Etap 4 — menu boczne i porządek interfejsu

- usunięto z mapy cały baner „Czekam na czujnik”,
- dodano pływający przycisk z trzema poziomymi kreskami w lewym górnym rogu,
- dodano wysuwane z lewej strony menu główne z przyciemnionym tłem,
- do menu przeniesiono ustawienia aplikacji oraz pomoc/instrukcję,
- z mapy usunięto osobne przyciski koła zębatego i pytajnika,
- w menu pozostawiono także skróty do nadajników, warstw i panelu kompasu,
- dotychczasowe funkcje GPS, mapy, nadajników, zasięgu, MUX-ów i profilu terenu nie zostały zmienione.

## Etap 3 — kompas i północ

- poprawione obliczanie kierunku absolutnego względem północy,
- uwzględniony obrót ekranu telefonu,
- odrzucane są względne odczyty czujnika, które powodowały dryf,
- preferowany jest `deviceorientationabsolute`, a na iOS `webkitCompassHeading`,
- wskazania po zmianie orientacji ekranu są ponownie synchronizowane,
- stożek kierunku, wskazówka telefonu i ikona N używają tej samej skorygowanej wartości,
- ikona N jest wyszarzona bez poprawnego odczytu i aktywna dopiero po uzyskaniu kierunku.

## Etap 2 — lokalizacja i sterowanie mapą

- przycisk lokalizacji przeniesiony do prawego dolnego rogu i powiększony,
- automatyczna próba lokalizacji po uruchomieniu aplikacji,
- po GPS mapa centruje się na użytkowniku z zoomem 18,
- wybór nadajnika nie wywołuje już `fitBounds()` i nie oddala mapy,
- maksymalny zoom mapy zwiększony z 18 do 22,
- dodane kontrolowane nadpowiększanie ostatnich dostępnych kafelków,
- kontrolki zoomu na komputerze przeniesione do lewego dolnego rogu,
- przycisk lokalizacji automatycznie przesuwa się nad kartę nadajnika.

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