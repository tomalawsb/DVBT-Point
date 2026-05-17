# DVB-T/T2 Point — Etap 18

Wersja: **18.0 - 1705261348**

Zmiany:

- stabilizacja kompasu: próbkowanie, uśrednianie kołowe i wolniejsze wygładzanie,
- stożek kierunku rysowany w osobnej warstwie Leaflet `headingPane`, ponad podkładami mapy,
- poprawiony profil terenu:
  - teren z Open-Meteo Elevation API,
  - wysokość gruntu nadajnika z `site_elevation_m`, jeśli jest w bazie,
  - brak profilu demonstracyjnego,
  - komunikat o źródle danych pod wykresem,
- skorygowane współrzędne obiektu Tarnów / Góra Św. Marcina według danych z aplikacji referencyjnej użytkownika.

Uwaga: kompas telefonu nadal zależy od czujników urządzenia i może skakać przy metalowych elementach, aucie, maszcie, antenie i magnesach.
