Diagnostyka ANT — wersja 19.6

Po pobraniu plików:
python download_ant_patterns.py

Możesz sprawdzić ich stan na dwa sposoby:

1. W aplikacji:
- otwórz Dane / API,
- kliknij „Uruchom diagnostykę ANT”.

2. W konsoli:
python validate_ant_patterns.py

Skrypt zapisze raport:
data/ant/diagnostics_report.json

Ważne:
Jeżeli podmieniasz całą paczkę programu, nie kasuj swoich pobranych plików *.ant z katalogu data/ant/.
Nowa paczka zawiera indeks i narzędzia, ale nie zawiera pobranych z internetu plików ANT.
