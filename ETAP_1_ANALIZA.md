# DVB-T/T2 Point — ETAP 1: analiza projektu i kopia bazowa

## Status

Etap 1 zakończony. Kod aplikacji nie został jeszcze zmieniony funkcjonalnie. Ta paczka jest kopią bazową do dalszych etapów.

## Czym jest program

Aplikacja jest mobilną aplikacją webową PWA, a nie programem napisanym w Pythonie i nie jest projektem Firebase.

Główne technologie:
- HTML5,
- CSS,
- JavaScript,
- Leaflet 1.9.4,
- PWA: `manifest.json` i `service-worker.js`,
- Python wyłącznie w narzędziach przygotowujących bazę nadajników i pliki ANT.

## Aktywne pliki aplikacji

Plik `index.html` ładuje:
- `style.css` z katalogu głównego,
- `app.js` z katalogu głównego.

Pliki `js/app.js` oraz `css/style.css` są starszymi, nieużywanymi kopiami. Nie będą podstawą kolejnych zmian.

## Obecna wersja

- Interfejs: `19.32 - 1905261015`
- Cache Service Workera: `dvbt-point-19-32-1905261015`

Do uporządkowania w kolejnych etapach:
- nagłówek `README.md` nadal opisuje starszy etap 19.23,
- rejestracja Service Workera ma stary parametr `v=19.30-1905260815`, mimo że sam Service Worker jest wersji 19.32.

## Analiza wymagań

### Lokalizacja i mapa

- Przycisk GPS jest obecnie po lewej stronie u góry.
- Lokalizacja uruchamia się wyłącznie po naciśnięciu przycisku.
- Po GPS mapa ustawia minimum zoom 12.
- Wybranie nadajnika wywołuje `fitBounds()` i pokazuje jednocześnie użytkownika oraz nadajnik. To powoduje oddalanie mapy.
- Mapa ma `maxZoom: 18`, mimo że część warstw dopuszcza zoom 19. To blokuje większe przybliżenie.
- Przy dalszym zwiększaniu zoomu trzeba zastosować kontrolowane nadpowiększenie kafelków, ponieważ różni dostawcy map mają różny maksymalny zoom natywny.

### Kompas

Obecna obsługa kompasu korzysta z:
- `deviceorientationabsolute`,
- `deviceorientation`,
- `webkitCompassHeading` na iOS,
- kursu GPS, gdy urządzenie go zwraca.

Znalezione słabe punkty:
- brak korekty zależnej od obrotu ekranu (`screen.orientation.angle`),
- jednoczesne nasłuchiwanie dwóch zdarzeń orientacji może dostarczać różne serie danych,
- brak informacji o dokładności czujnika,
- wygładzanie opiera się tylko na kilku ostatnich próbkach,
- automatyczne uruchomienie kompasu może zostać zablokowane przez przeglądarkę do czasu pierwszego dotknięcia ekranu,
- przycisk „N” jedynie obraca ikonę; mapa sama nie jest obracana.

Linia między użytkownikiem a nadajnikiem jest rysowana bezpośrednio z aktualnych współrzędnych obu punktów. Problem wymagający poprawy dotyczy przede wszystkim zgodności kierunku czujnika telefonu z azymutem i orientacją ekranu.

### Baner „Czekam na czujnik”

Nie jest osobnym banerem. Jest częścią widżetu `compassWidget`. W etapie przebudowy interfejsu widżet zostanie usunięty albo zastąpiony znacznie prostszym wskaźnikiem.

### Nadajniki i multipleksy

- Nadajnik zawiera listę MUX-ów.
- Aktualny orientacyjny zasięg jest liczony na podstawie największej mocy ERP spośród wszystkich MUX-ów nadajnika.
- Program nie ma jeszcze stanu „wybrany MUX”.
- Do poprawnej obsługi trzeba dodać `selectedMux` i powiązać z nim zasięg, moc, kanał, częstotliwość, polaryzację i ewentualny wzorzec ANT.
- Pole wyszukiwania listy nadajników jest obecnie automatycznie aktywowane przez `input.focus()`, dlatego od razu pojawia się klawiatura telefonu.

### Menu i warstwy

- Obecne funkcje są rozmieszczone w pionowym pasku po prawej stronie.
- Ustawienia i pomoc są osobnymi ikonami.
- Panel aplikacji jest obecnie panelem dolnym na telefonie, a nie bocznym drawerem.
- Warstwy są już obsługiwane logicznie, lecz interfejs wymaga przebudowy na kafelkowy panel podobny do Google Maps.
- Książka referencyjna nie istnieje i zostanie dodana jako osobna sekcja menu.

## Pliki przewidziane do zmian

Najważniejsze:
- `index.html` — układ ikon, menu boczne, elementy interfejsu,
- `style.css` — pełna przebudowa położenia i wyglądu kontrolek,
- `app.js` — GPS, kompas, zoom, wybór MUX, menu i książka referencyjna,
- `service-worker.js` — aktualizacja cache po każdym wydaniu,
- `README.md` — aktualny opis wersji.

Możliwe nowe pliki:
- `data/reference.json` — dane książki referencyjnej,
- osobne moduły JavaScript, jeśli dalszy rozwój będzie wymagał podziału dużego `app.js`.

## Wykonane testy statyczne

- składnia głównego `app.js`: poprawna,
- składnia pomocniczego `js/app.js`: poprawna,
- kompilacja wszystkich skryptów Python: poprawna,
- wszystkie pliki JSON: poprawne składniowo,
- baza nadajników jest dostępna w `data/transmitters.json`,
- aktywny kod aplikacji korzysta wyłącznie z plików głównych `app.js` i `style.css`.

Pełny test GPS i kompasu musi zostać wykonany na fizycznym telefonie, ponieważ komputerowy test automatyczny nie odwzoruje zakłóceń magnetometru, obrotu telefonu i dokładności lokalizacji.

## Kolejny etap

Etap 2 obejmie razem:
- przeniesienie przycisku lokalizacji do prawego dolnego rogu,
- automatyczną lokalizację po uruchomieniu,
- centrowanie i mocniejsze zbliżenie na użytkownika,
- zatrzymanie automatycznego oddalania do nadajnika,
- zwiększenie maksymalnego zoomu mapy.
