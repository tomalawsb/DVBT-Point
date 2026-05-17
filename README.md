# DVB-T/T2 Mapa Instalatora — Etap 11

Wersja: **11.0 - 1705261630**

Etap 11 robi to, co da się zrobić bez Twojej decyzji o źródle danych: aplikacja nadal działa jak PWA z Etapu 10, ale dostała przygotowanie pod prawdziwą bazę nadajników.

## Co dodano

- lokalny import bazy nadajników z pliku **JSON** albo **CSV**,
- eksport aktualnej bazy nadajników do JSON,
- oznaczenie źródła danych w panelu PWA / Offline,
- plik `data/sources.json` z listą sensownych źródeł danych,
- plik `data/transmitters-template.csv` jako wzór importu,
- skrypt `tools/convert_csv_to_transmitters.py` do konwersji CSV → JSON,
- poprawiony cache PWA do wersji 11,
- zachowane funkcje z Etapu 10: mapa, PWA/offline, kompas, profil terenu, warstwy, orientacyjne pokrycie.

## Ważne

Plik `data/transmitters.json` nadal jest demonstracyjny. Różnica jest taka, że aplikacja umie już przyjąć prawdziwą bazę nadajników bez zmiany kodu.

## Import bazy nadajników w aplikacji

1. Otwórz aplikację.
2. Kliknij przycisk **PWA**.
3. Wybierz **Importuj bazę nadajników JSON/CSV**.
4. Wskaż plik zgodny ze strukturą `data/transmitters-template.csv` albo gotowy JSON.
5. Aplikacja zapisze bazę lokalnie w przeglądarce.

## Format CSV

Wzór jest w pliku:

```text
/data/transmitters-template.csv
```

Najważniejsze kolumny:

```text
name,site,lat,lon,height_m,mast_m,region,mux,channel,frequency_mhz,erp_kw,polarization,band,source
```

Jeden nadajnik może mieć kilka wierszy — po jednym dla każdego MUX-a.

## Konwerter CSV → JSON

Na komputerze możesz użyć:

```bash
python tools/convert_csv_to_transmitters.py wejscie.csv data/transmitters.json
```

Potem wrzucasz zmieniony `data/transmitters.json` na GitHub.

## Źródła, które trzeba rozważyć

- UKE — oficjalny wykaz pozwoleń radiowych dla stacji telewizyjnych,
- Emitel — tabela parametrów emisji DVB-T/DVB-T2,
- RadioPolska — dane z Wykazu na licencji CC BY 4.0, ale z obowiązkiem oznaczenia źródła/licencji.

## GitHub Pages

Wrzuć zawartość katalogu do repozytorium i włącz GitHub Pages. Aplikacja powinna działać pod adresem:

```text
https://twoj-login.github.io/nazwa-repozytorium/
```

## Ograniczenia

- gotowe mapy pokrycia RadioPolska/Emitel nie są kopiowane,
- prawdziwa mapa pokrycia wymaga albo licencji/API, albo własnego generatora propagacji,
- orientacyjna warstwa z Etapu 10 nadal nie jest oficjalnym pokryciem DVB-T/T2,
- profil terenu i pokrycie wymagają internetu, bo korzystają z Open-Meteo Elevation API.
