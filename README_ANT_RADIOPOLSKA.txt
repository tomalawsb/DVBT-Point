ANT RadioPolska - instrukcja dla wersji 19.4

Co to jest:
Pliki ANT opisują charakterystykę kierunkową anteny nadawczej. Dzięki nim aplikacja może osłabiać lub wzmacniać zasięg w konkretnych kierunkach, zamiast rysować zasięg jak dla anteny dookólnej.

Gdzie są linki:
Linki pochodzą z pola Link_ANT z eksportu RadioPolska. W aplikacji zostały zapisane w:

data/ant/index.json

Jak pobrać pliki:
1. Otwórz terminal w katalogu aplikacji.
2. Uruchom:

python download_ant_patterns.py

Na próbę:

python download_ant_patterns.py --limit 20

Gdzie zapiszą się pliki:

data/ant/

Jak aplikacja ich używa:
- data/transmitters.json wskazuje lokalną ścieżkę ant_pattern_path dla każdego MUX-a.
- app.js próbuje pobrać ten lokalny plik podczas obliczania RF.
- Jeżeli plik istnieje i da się go sparsować, aplikacja uwzględnia kierunkowość anteny.
- Jeżeli pliku nie ma, obliczenia nadal działają, tylko bez korekty kierunkowej.

Uwaga:
W Twoim eksporcie część rekordów ma link z ID 0. Takie linki są podejrzane i downloader domyślnie je pomija.
