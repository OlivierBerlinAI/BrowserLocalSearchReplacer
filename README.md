# Browser Local Search & Replacer

A small, fully offline web app for anonymizing and de-anonymizing text with
workspace-specific keyword lists.

- **Server:** a zero-dependency Node.js static file server. It holds no state
  and only delivers the files in `public/`.
- **Client:** plain HTML/CSS/JS. Workspaces and keywords are stored **only in
  the browser's `localStorage`**. Nothing is ever sent to the server.

## Requirements

- Node.js 18 or newer (tested with Node 22).
- No internet connection needed. `npm install` installs nothing (there are no
  dependencies); it is safe to run and safe to skip.

## Run

```bash
npm install   # optional, no dependencies
npm start     # serves on http://0.0.0.0:8080
```

The console prints the local and LAN URLs. Change port/host with env vars:

```bash
PORT=3000 HOST=127.0.0.1 npm start
```

## Test

```bash
npm test
```

## Usage

1. **Workspaces** (left bar): create, select, rename (click the title), delete.
2. **Keywords**: each row has a keyword, its replacement and two per-keyword
   options:
   - *Case-insensitive* – `Acme`, `ACME` and `acme` all match.
   - *Whole word* – `Ann` does not match inside `Annual`.
   The workspace-level option *Longest keyword first* makes `John Smith` win
   over `John` when both are keywords.
   *Table* / *Compact* switches the view. Compact shows one entry row
   (keyword, replacement, `Aa` = case-insensitive, `W` = whole word; Enter
   adds) and the existing keywords as pills `keyword → replacement Aa W ×`.
   Click the `Aa`/`W` icons on a pill to toggle the option, `×` to remove
   it, and the pill text to load it into the entry row for editing (Enter
   saves, Escape cancels). Both views edit the same data.
   The table shows at most 10 rows and scrolls beyond that (header stays
   visible). Drag the handle at its bottom-right corner to set the height by
   hand; it is remembered until you click *Reset to automatic*.
   Click the *Keywords* heading to collapse the table and free vertical space
   for the text area; the state is remembered.
   Press **Insert** to toggle overwrite mode for the keyword/replacement
   fields (typing replaces the character under the cursor, handy for editing
   fixed-length IDs). An *OVR* badge shows while it is active.
3. **Mode switch** (*Anonymize* / *De-anonymize*) above the text area.
   *Live update* (on by default) recomputes the result after every change to
   the text or the keywords and hides the run button; untick it to run
   manually with the button or `Ctrl/Cmd+Enter`.
   - *Anonymize*: left column *Original*, right column *Anonymized*. Every
     keyword is replaced by its replacement in a single pass (the output of one
     rule is never re-processed by another).
   - *De-anonymize*: the reverse mapping (replacement → keyword) using the same
     per-keyword options.
   The two columns scroll together (by relative position) and share the same
   height; dragging the resize handle of one resizes both.
   The texts in both columns are kept per workspace and per mode while the
   page is open. Tick *Keep texts across reload* in the workspace header to
   also store them in localStorage (they are then part of the workspace and
   included in an export).
   Keywords in the original text are highlighted yellow, replacements in the
   anonymized text blue, live while you type. (Technically each textarea is
   transparent and sits over a backdrop that renders the same text with
   `<mark>` elements.)
4. **Export / Import JSON**: back up or move workspaces between browsers.
   Import always *adds* workspaces; it never overwrites existing ones.
5. **Reset all**: wipes everything from this browser's localStorage.

Keyboard: `Ctrl/Cmd+Enter` in the input runs the current mode; `Enter` in a
replacement field adds a new keyword row.

## Project layout

```
server.js            static file server (no state)
public/index.html    UI markup
public/styles.css    styling
public/replacer.js   pure search/replace engine (browser + Node)
public/app.js        UI logic + localStorage persistence
test/replacer.test.js
```
