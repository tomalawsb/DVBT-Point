# DVB-T/T2 Point — 14.0 - 1705261138

Etap 14 po poprawkach:

- przywrócony prawdziwy profil terenu,
- profil pobierany z Open-Meteo Elevation API / Copernicus DEM GLO-90,
- brak trybu wymyślonego profilu — jeżeli API nie odpowie, aplikacja pokazuje błąd,
- nadajniki nadal są widoczne na mapie,
- dodany panel Dane / API,
- dodany import nadajników z JSON/CSV,
- dodane linki do oficjalnych CSV UKE,
- dodana opcja płatnego/licencjonowanego API elewacji,
- dodana opcja prawdziwej warstwy pokrycia z GeoJSON albo płatnych/licencjonowanych kafelków,
- nie rysuję udawanego zasięgu jako prawdziwego.

## Ważne

Gotowe mapy pokrycia RadioPolska/Emitel nie zostały skopiowane. Do aplikacji można podłączyć tylko legalnie uzyskaną warstwę GeoJSON albo URL kafelków z licencją/API.

## Źródła w paczce

- `data/sources.json` — opis darmowych i opcjonalnych płatnych źródeł,
- `data/coverage.geojson` — pusty szablon prawdziwej warstwy zasięgu,
- `data/transmitters.json` — nadal awaryjna baza startowa, do zastąpienia importem.

## Po wrzuceniu na GitHub Pages

Wyczyść cache PWA albo użyj panelu PWA → Wymuś aktualizację.
