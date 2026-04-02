# torg

A keyboard-driven outliner that uses an [org-mode](https://orgmode.org/) file as its database.

Think Workflowy or Dynalist, but your data lives in a plain text `.org` file you can edit anywhere — Emacs, vim, or any text editor.

## How it works

torg is a single Go binary that serves a web UI. Your outline is stored as a standard org-mode file with `*` headings for hierarchy. No database, no proprietary format.

```
* Inbox
** Buy groceries
** Read chapter 5
* Projects
** Build torg app
*** Design API
*** Implement frontend
* Ideas
```

## Quick start

```
make build
./torg -file myfile.org
```

Opens `http://localhost:8080` in your browser. If the file doesn't exist, it's created.

### Flags

```
-file   path to org file (default: outline.org)
-addr   listen address (default: :8080)
```

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate between items |
| `Enter` | Create new item below |
| `Backspace` | Delete empty item |
| `Tab` / `Shift+Tab` | Fold / unfold children |
| `Alt + ←` / `→` | Outdent / indent |
| `Alt + ↑` / `↓` | Move item up / down (crosses parent boundaries) |
| `Ctrl + H` | Toggle help panel |

## Architecture

- **Go backend** parses the org file with [go-org](https://github.com/niklasfasching/go-org), serves a REST API, and embeds the frontend as static files into a single binary.
- **React frontend** loaded from CDN (no npm, no build step). Pure ES modules with [htm](https://github.com/developit/htm) for JSX-like templates.
- **Flat list model** internally — each item has a level number, and the tree is derived for display. This makes move/indent/outdent operations simple array manipulations.
- **Sidecar file** (`.meta.json`) stores UI state like collapsed nodes, keeping the org file clean.

## Development

```
make help     # show available targets
make build    # build the binary
make run      # build and run with test.org
make test     # run tests
```

The frontend lives in `internal/server/web/` and is embedded at compile time. Edit the HTML/CSS/JS there, rebuild, and refresh.
