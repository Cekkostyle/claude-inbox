# Inbox – Notizzettel für Claude Code

Eine Mod für Claude Code: Über dem Prompt steht eine kleine Leiste, in die du
Aufgaben notierst, **während Claude noch arbeitet**, ohne die laufende Arbeit zu
unterbrechen. Die Notizen landen als Checkliste in `.claude/INBOX.md` im Projekt
der jeweiligen Session. Claude kann sie danach abarbeiten und abhaken.

```
📝 Inbox: 3 offen  [Notiz +]  [Modus: Manuell]  [▶ Abarbeiten]
```

## Installation

Im Claude-Code-Terminal am Prompt:

```
/plugin install inbox --marketplace Cekkostyle/claude-inbox
```

Die Frage `Add marketplace?` mit `y` bestätigen und den Scope wählen (User-Scope
= in jeder Session aktiv).

Aus einer Shell:

```
claude plugin install inbox --marketplace Cekkostyle/claude-inbox
```

In der Desktop-App: **+** neben dem Prompt → Plugins → Add marketplace mit
`Cekkostyle/claude-inbox` → Add plugin.

## Bedienung

- **Notiz +** öffnet ein Eingabefeld; Enter speichert, das Feld bleibt für die
  nächste Notiz offen. Offene Aufgaben werden nummeriert mit **✎** (bearbeiten)
  und **✕** (löschen) angezeigt.
- **Modus: Manuell** – Claude rührt die Liste nicht an. **▶ Abarbeiten** schickt
  alle offenen Punkte los (wenn Claude gerade arbeitet: direkt danach).
  Ideal, um einen Build durchzutesten und alles aufzuschreiben.
- **Modus: Auto** – beim Umschalten wird alles Offene übergeben; danach gehen
  neue Notizen automatisch an Claude, sobald es frei ist (nach 15 s Sammelpause).
- Claude gruppiert die Punkte nach Thema, gibt unabhängige Themen parallel an
  Subagenten, hakt Erledigtes in der Datei ab (`- [x]`) und hängt bei Unklarem
  ` — Rückfrage: …` an. Solche Punkte startet der Auto-Modus nicht erneut.
- Die Datei kann auch von Hand bearbeitet werden; die Leiste liest sie alle 3 s neu.

### Befehle

| Befehl | Wirkung |
| --- | --- |
| `/inbox` | Eingabefeld ein/aus |
| `/inbox <Text>` | Aufgabe notieren |
| `/inbox del <Nr>` | offene Aufgabe Nr. löschen |
| `/inbox edit <Nr> <Text>` | offene Aufgabe Nr. ändern |
| `/inbox run` | alle offenen Aufgaben jetzt übergeben |
| `/inbox auto` / `/inbox manuell` | Modus umschalten |

## Lizenz

MIT
