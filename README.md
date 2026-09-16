# Browser Local Search & Replacer

A small, fully offline web app for anonymizing and de-anonymizing text with
workspace-specific keyword lists.

- **Server:** a zero-dependency Node.js static file server. It holds no state
  and only delivers the files in `public/`.
- **Client:** plain HTML/CSS/JS. Workspaces and keywords are stored **only in
  the browser's `localStorage`**. Nothing is ever sent to the server.

## Privacy

The server only serves the files in `public/` (GET/HEAD, no logging, no
storage); the page makes no network requests after loading, and every response
carries a strict `Content-Security-Policy` (`connect-src 'none'`,
`form-action 'none'`, everything else `'self'` or `'none'`), so the browser
itself refuses any outgoing connection from the page. There are no accounts, no
cookies and no tracking. Everything you
enter stays in the browser's localStorage, which is **not encrypted**: it is
plain data in the browser profile on disk, readable by anyone with access to
that OS account. Wildcard mappings contain the original values. Do not use
real passwords or secrets as keywords, and use the app over a LAN only if you
trust that network (plain HTTP can be tampered with in transit). The *Privacy*
link in the sidebar opens a dialog with the details.

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
npm test          # engine unit tests (no dependencies)
npm run test:ui   # browser tests with Playwright (headless Chromium)
npm run test:all
```

The browser tests need Playwright's Chromium once: `npm install` then
`npx playwright install chromium` (about 115 MB). Alternatively point
`BLSR_BROWSER_PATH` at an existing Chromium/Chrome binary. Each test starts the
server on a free port, opens a fresh page with an empty localStorage and drives
the real UI (rules, wildcards, mappings, demos, selection popup, dialogs, CSP).
The GitHub Actions workflow in `.github/workflows/test.yml` runs both suites on
every push.

## Deployment

The server is stateless and only reads `public/`, so any static host works.
Put HTTPS in front of it: without it, the JavaScript can be tampered with on
the way to the user, and the browser's Web Crypto API (needed for future
encryption features) is only available on HTTPS or localhost.

**Docker behind your own nginx (recommended if the host already runs nginx
with Let's Encrypt):**

```bash
docker compose up -d            # container listens on 127.0.0.1:8080 (PORT=8090 to change)
```

`docker-compose.yml` builds the app image (`Dockerfile`, Node 22 Alpine, runs
as the unprivileged `node` user, health check) and publishes it only on
localhost. Add the server block from `deploy/nginx.conf` to your nginx
(`proxy_pass http://127.0.0.1:8080`), run certbot for the domain, reload.

**Docker + Caddy (server without its own web server):**
`deploy/docker-compose.caddy.yml` starts the app together with Caddy, which
obtains Let's Encrypt certificates itself:
`DOMAIN=anon.example.com docker compose -f deploy/docker-compose.caddy.yml up -d`.

**Without Docker (systemd + nginx or Caddy on the host):**
`deploy/blsr.service` runs `server.js` as a dedicated user on `127.0.0.1:8080`
with systemd hardening; `deploy/nginx.conf` or `deploy/Caddyfile.host` provide
the HTTPS front. Install steps are in the comments of each file.

After deploying, open the site, then in the browser's developer tools check
the response headers of `/`: `Content-Security-Policy` and
`X-Content-Type-Options` must come through the proxy unchanged (both Caddy and
nginx pass upstream headers through by default; do not override them with
`add_header`/`header` directives of your own).

## Usage

1. **Workspaces** (left bar): create, select, rename (click the title), delete.
   Three **demo workspaces** (Basics, Wildcards with JSON, Log file) are added
   automatically and marked with a *demo* badge; a blue note above the
   keywords explains what each one shows. They can be edited like any other
   workspace. *Hide demo* (instead of delete) only hides them in this browser
   (a `hidden` flag in localStorage); *Restore demo workspaces* in the sidebar
   footer brings them back. Hidden demos are not exported; imported copies of
   demos become ordinary workspaces. The demo definitions live in
   `public/demos.js`.
2. **Keywords**: each row has a keyword, its replacement and four per-keyword
   options:
   - *Case-insensitive* – `Acme`, `ACME` and `acme` all match.
   - *Whole word* – `Ann` does not match inside `Annual`.
   The workspace-level option *Longest keyword first* makes `John Smith` win
   over `John` when both are keywords.
   - *Wildcards* (`%`) – keyword and replacement become templates. `%d`
     matches a number (`21.0`, `-3,50`), `%i` digits, `%s` letters, `%a`
     letters and digits, `%x` hex, `%%` a literal percent sign. Every matched
     value is replaced by a random value of the same shape (same length,
     same number of decimals, same letter case, never equal to the input).
     The n-th wildcard in the replacement receives the n-th matched value; the
     fixed text may differ, so `"price": %d` → `"amount": %d` renames the key
     and randomizes the value. Turning wildcards on pre-fills an empty
     replacement with the keyword.
     The keyword may also hold a concrete *example* while only the
     replacement has wildcards: `anImportantId: "1234454"` →
     `anImportantId: "%i"` is read as `anImportantId: "%i"` on both sides
     (dashed keyword border, tooltip shows the effective pattern). If the
     example does not fit the replacement's shape, the rule is marked orange
     and matches only literally.
   - *Text in seed* (`S`, wildcard rules only) – also feeds the fixed text of
     the pattern into the random seed, so `BB%i` and `CC%i` produce different
     digits for the same input. Off by default: the same value gets the same
     random value regardless of the surrounding text.
   Literal keywords always take precedence over wildcard rules; wildcard rules
   apply in list order. A *Hits* column (or a small number on the pill) shows
   how often each rule matched the current text.
   **Quick add from the text:** select a word or phrase in the *Original*
   box and a small popup appears under the selection with the selected text,
   a suggested replacement and an *Anonymize* button; Enter adds the rule,
   Esc closes the popup. Words and names get a plain replacement (`ANON_1`,
   `ANON_2`, …). Values with a recognizable shape get a wildcard suggestion
   (`21.0` → `%d`, `4711` → `%i`, `BB12345678` → `BB%i`, `192.168.1.7` →
   `%i.%i.%i.%i`, `3fa9c0de` → `%x`, `anna@example.com` → `%s@%s.%s`), added
   as an example → template rule; the wildcard button in the popup switches
   to a plain keyword instead. Only in Anonymize mode,
   single-line selections up to 200 characters; existing keywords are not
   added twice.
   *Help* (in the Keywords header) opens a dialog with all wildcards, both ways
   of writing a rule, the options, seed/mappings and the keyboard shortcuts.
3. **Wildcard mappings**: random values are derived from a per-workspace
   *seed* and the matched value, so the same input always gives the same
   output. Since that cannot be inverted, every wildcard replacement is
   recorded as a mapping *original → anonymized* in this section and used to
   restore the original when de-anonymizing. Seed and mappings are part of
   the workspace, live in localStorage and are included in the JSON export,
   so de-anonymizing works wherever the workspace is imported. With live
   update on, mappings are written once the text has settled for about 1.5 s
   (or immediately on *Copy result*, the run button, a mode or workspace
   switch). *New seed* changes all future random values; old mappings are
   kept so earlier texts still restore. Single mappings can be removed, or
   all with *Clear mappings*. The section is hidden until the workspace has a
   wildcard rule or a mapping.
   *Table* / *Compact* switches the view. Compact shows one entry row
   (keyword, replacement, `Aa` = case-insensitive, `W` = whole word; Enter
   adds) and the existing keywords as pills `keyword → replacement [icons] ×`.
   A pill only shows the options that are on, as icons (letter case =
   case-insensitive, underlined A = whole word, `.*` = wildcards, leaf = text
   in seed; hover for the name); click one to turn it off,
   `×` to remove the keyword, and the pill text to load it into the entry
   row for editing, where options can be turned on (Enter saves, Escape
   cancels). Both views edit the same data.
   The table shows at most 10 rows and scrolls beyond that (header stays
   visible). Drag the handle at its bottom-right corner to set the height by
   hand; it is remembered until you click *Reset to automatic*.
   Click the *Keywords* heading to collapse the table and free vertical space
   for the text area; the state is remembered.
   Press **Insert** to toggle overwrite mode for the keyword/replacement
   fields (typing replaces the character under the cursor, handy for editing
   fixed-length IDs). An *OVR* badge shows while it is active.
4. **Mode switch** (*Anonymize* / *De-anonymize*) above the text area.
   *Live update* (on by default) recomputes the result after every change to
   the text or the keywords and hides the run button; untick it to run
   manually with the button or `Ctrl/Cmd+Enter`.
   - *Anonymize*: left column *Original*, right column *Anonymized*. Every
     keyword is replaced by its replacement in a single pass (the output of one
     rule is never re-processed by another).
   - *De-anonymize*: the reverse mapping (replacement → keyword) using the same
     per-keyword options, plus the recorded wildcard mappings
     (anonymized → original).
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
5. **Export / Import JSON**: back up or move workspaces between browsers
   (including seed and wildcard mappings). Import always *adds* workspaces;
   it never overwrites existing ones. Files and the stored state carry a
   schema `version` (currently 2); older formats are migrated on load and on
   import by `public/migrations.js`, data from a newer app version loads with
   a warning.
6. **Reset all**: wipes everything from this browser's localStorage.

Keyboard: `Ctrl/Cmd+Enter` in the input runs the current mode; `Enter` in a
replacement field adds a new keyword row.

## Icons

The option icons and the favicon come from
[Material Design Icons](https://pictogrammers.com/library/mdi/) 7.4.47
(Pictogrammers Free License / Apache 2.0). The five icons used are embedded
as an SVG sprite at the top of `index.html`, the favicon is `favicon.svg`;
nothing is fetched from another server.

## Project layout

```
server.js            static file server (no state)
public/index.html    UI markup
public/styles.css    styling
public/replacer.js   pure search/replace engine (browser + Node)
public/migrations.js schema version + migrations for stored/exported data
public/demos.js      the three demo workspaces
public/app.js        UI logic + localStorage persistence
public/favicon.svg   tab icon
test/replacer.test.js  engine unit tests
test/ui/             browser tests (Playwright harness + tests)
Dockerfile, docker-compose.yml, deploy/  deployment (Docker behind nginx, Caddy variant, systemd)
```
