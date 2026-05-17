# DVB-T/T2 Point — Etap 15

Wersja: **15.0 - 1705261308**

Etap 15 to reset konstrukcji interfejsu po problemach z mapą na telefonie.

## Najważniejsze zmiany

- Mapa jest czystym, pełnoekranowym elementem Leaflet bez kontenerów ograniczających rozmiar.
- Usunięto agresywne ustawienia `position: fixed` na `body`, które mogły rozjeżdżać kafelki na Androidzie.
- Panel nadajnika jest domyślnie zamykalny i nie blokuje mapy.
- Kliknięcie mapy zamyka panele.
- Kompas jest lżejszym overlayem, a nie dużym panelem.
- Nadajniki są widoczne na mapie jako markery.
- Profil terenu jest realny: pobierany z Open-Meteo Elevation API.
- Brak profilu demonstracyjnego — przy błędzie API aplikacja pokazuje błąd.

## Wrzucenie na GitHub Pages

Wrzuć zawartość paczki do repozytorium i opublikuj przez GitHub Pages.

Po aktualizacji na telefonie najlepiej wyczyścić stare dane witryny albo w panelu Dane/API użyć wymuszenia aktualizacji PWA.

## Ograniczenia

- Baza nadajników jest lokalna w `data/transmitters.json`.
- Profil terenu wymaga internetu.
- Kafelki mapy wymagają internetu, jeśli nie są już w cache przeglądarki.
- Prawdziwe mapy pokrycia RadioPolska/Emitel nie są kopiowane, bo wymagają legalnego źródła/licencji/API.
