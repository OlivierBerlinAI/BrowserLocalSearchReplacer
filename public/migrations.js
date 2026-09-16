'use strict';
// Schema version of the persisted state (localStorage) and of exported JSON
// files, with step-by-step migrations. Works in the browser (global
// `Migrations`) and in Node (module.exports).
//
// History:
//   1  initial format: { version, activeWorkspaceId, workspaces: [{ id, name,
//      longestFirst, persistTexts, rules: [{ keyword, replacement,
//      caseInsensitive, wholeWord }], texts? }], mode, rulesCollapsed, ... }
//   2  wildcard rules (rule.pattern, rule.seedIncludesText), per-workspace
//      seed and mappings, demo workspaces (demo, hidden, help),
//      mappingsCollapsed. Older data is valid as is; the normalizers fill in
//      the defaults, so the migration only stamps the version.
//
// Adding a version: bump SCHEMA_VERSION, add MIGRATIONS[<old version>] that
// converts from <old version> to <old version + 1>, and describe it above.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Migrations = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SCHEMA_VERSION = 2;

  const MIGRATIONS = {
    1: function v1to2(s) {
      // Nothing to rewrite: new fields are optional and defaulted on load.
      return s;
    },
  };

  function versionOf(raw) {
    if (Array.isArray(raw)) return 1; // very early exports were a bare workspace array
    const v = raw && Number(raw.version);
    return Number.isInteger(v) && v >= 1 ? v : 1;
  }

  /**
   * Brings a parsed state or export object to the current schema.
   * @returns {{ data: Object, from: number, warnings: string[] }}
   *   data always has `version: SCHEMA_VERSION` and a `workspaces` array.
   */
  function migrate(raw) {
    const warnings = [];
    let data = Array.isArray(raw) ? { workspaces: raw } : Object.assign({}, raw || {});
    if (!Array.isArray(data.workspaces)) data.workspaces = [];
    const from = versionOf(raw);
    let v = from;
    if (v > SCHEMA_VERSION) {
      warnings.push(`This data was saved by a newer version of the app (format ${v}, this app knows ${SCHEMA_VERSION}). Unknown settings may be lost when it is saved again.`);
    } else {
      while (v < SCHEMA_VERSION) {
        const step = MIGRATIONS[v];
        if (typeof step !== 'function') {
          warnings.push(`No migration from format ${v} to ${v + 1}; loading with defaults.`);
          break;
        }
        data = step(data);
        v++;
      }
    }
    data.version = SCHEMA_VERSION;
    return { data, from, warnings };
  }

  return { SCHEMA_VERSION, migrate, versionOf };
});
