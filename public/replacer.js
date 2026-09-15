'use strict';
// Pure search/replace engine. Works in the browser (global `Replacer`) and in Node (module.exports).
//
// A rule: { keyword, replacement, caseInsensitive, wholeWord, pattern, seedIncludesText }
// Options: { longestFirst, seed, mappings }
//
// Literal rules replace the keyword by the replacement verbatim. With `pattern`
// set, keyword and replacement are templates with wildcards (%d number, %i digits,
// %s letters, %a letters+digits, %x hex, %% literal percent). Every value matched
// by a wildcard is replaced by a random value of the same shape. The random value
// is derived deterministically from the workspace `seed` and the matched value,
// so the same input always yields the same output. Because that cannot be
// inverted, each pattern replacement is reported as a mapping { from, to }; the
// caller stores these and passes them back as `mappings` for de-anonymizing.
//
// All rules are compiled into ONE alternation regex and applied in a single pass,
// so an output of one rule is never re-matched by another rule.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Replacer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WORD_CHAR = '[\\p{L}\\p{N}_]';
  const WORD_RE = new RegExp('^' + WORD_CHAR + '$', 'u');

  // Wildcards a pattern rule may contain. `pattern` is the regex source that matches
  // a value, `label`/`example` are for the UI.
  const PLACEHOLDERS = {
    d: { pattern: '-?[0-9]+(?:[.,][0-9]+)?', label: 'number', example: '21.0' },
    i: { pattern: '[0-9]+', label: 'digits', example: '12345678' },
    s: { pattern: '\\p{L}+', label: 'letters', example: 'Smith' },
    a: { pattern: '[\\p{L}\\p{N}]+', label: 'letters and digits', example: 'X7K2' },
    x: { pattern: '[0-9a-fA-F]+', label: 'hex', example: '3fa9' },
  };

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  }

  // Build a pattern for a literal string; case-insensitive matching is expressed
  // per character so it can be mixed with case-sensitive alternatives in one regex.
  function literalPattern(text, caseInsensitive) {
    if (!caseInsensitive) return escapeRegex(text);
    let out = '';
    for (const ch of text) {
      const lower = ch.toLowerCase();
      const upper = ch.toUpperCase();
      if (lower !== upper && lower.length === 1 && upper.length === 1) {
        out += '[' + escapeRegex(lower) + escapeRegex(upper) + ']';
      } else {
        out += escapeRegex(ch);
      }
    }
    return out;
  }

  function isWordChar(ch) {
    return ch !== undefined && WORD_RE.test(ch);
  }

  // Only guard an edge with a boundary if the text itself starts/ends with a word char;
  // otherwise "GmbH & Co." would never match because "." is not a word char.
  function wrapWholeWord(pattern, firstIsWord, lastIsWord) {
    const pre = firstIsWord ? '(?<!' + WORD_CHAR + ')' : '';
    const post = lastIsWord ? '(?!' + WORD_CHAR + ')' : '';
    return pre + pattern + post;
  }

  // ---------- Templates ----------
  // "BB%i" -> [{ type: 'lit', text: 'BB' }, { type: 'ph', kind: 'i' }]
  // "%%" is a literal percent sign; an unknown "%z" stays literal text.
  function parseTemplate(str) {
    const segs = [];
    let lit = '';
    const s = typeof str === 'string' ? str : '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '%' && i + 1 < s.length) {
        const next = s[i + 1];
        if (next === '%') { lit += '%'; i++; continue; }
        if (PLACEHOLDERS[next]) {
          if (lit) { segs.push({ type: 'lit', text: lit }); lit = ''; }
          segs.push({ type: 'ph', kind: next });
          i++;
          continue;
        }
      }
      lit += ch;
    }
    if (lit) segs.push({ type: 'lit', text: lit });
    return segs;
  }

  function placeholderKinds(segs) {
    return segs.filter((s) => s.type === 'ph').map((s) => s.kind);
  }

  // Text of a template with no values to fill in: wildcards are kept as written.
  function renderLiteral(segs) {
    return segs.map((s) => (s.type === 'lit' ? s.text : '%' + s.kind)).join('');
  }

  // ---------- Deterministic random values ----------
  function hash53(str, seed) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return [h1 >>> 0, h2 >>> 0];
  }

  // sfc32 PRNG seeded from a string; returns a function yielding [0, 1).
  function prng(str) {
    let [a, b] = hash53(str, 0);
    let [c, d] = hash53(str, 0x9e3779b9);
    const next = function () {
      a |= 0; b |= 0; c |= 0; d |= 0;
      const t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
    for (let i = 0; i < 12; i++) next(); // mix the state
    return next;
  }

  function pick(rng, chars) {
    return chars[Math.floor(rng() * chars.length)];
  }

  const DIGITS = '0123456789';
  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const HEX_LOWER = '0123456789abcdef';
  const HEX_UPPER = '0123456789ABCDEF';

  // Same length; keeps "no leading zero" if the original had none.
  function genDigits(str, rng) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      out += i === 0 && str.length > 1 && str[0] !== '0' ? pick(rng, DIGITS.slice(1)) : pick(rng, DIGITS);
    }
    return out;
  }

  // A random character of the same class (digit, upper, lower); anything else is kept.
  function genChar(ch, rng) {
    if (/[0-9]/.test(ch)) return pick(rng, DIGITS);
    const lower = ch.toLowerCase();
    const upper = ch.toUpperCase();
    if (lower === upper) return ch; // not a cased letter (digit-like symbols etc.)
    return ch === upper ? pick(rng, UPPER) : pick(rng, LOWER);
  }

  function genOnce(kind, value, rng) {
    switch (kind) {
      case 'i':
        return genDigits(value, rng);
      case 'd': {
        const m = /^(-?)([0-9]+)(?:([.,])([0-9]+))?$/.exec(value);
        if (!m) return genDigits(value, rng);
        // "0.5" keeps its leading zero so the magnitude stays similar.
        const int = m[2] === '0' && m[3] ? '0' : genDigits(m[2], rng);
        const frac = m[4] ? [...m[4]].map((ch) => genChar(ch, rng)).join('') : '';
        return m[1] + int + (m[3] || '') + frac;
      }
      case 'x': {
        const alphabet = /[A-F]/.test(value) ? HEX_UPPER : HEX_LOWER;
        return [...value].map(() => pick(rng, alphabet)).join('');
      }
      default: // 's', 'a'
        return [...value].map((ch) => genChar(ch, rng)).join('');
    }
  }

  function seedKey(seed, value, context) {
    return (seed || '') + '' + value + (context === null ? '' : '' + context);
  }

  /**
   * Random value of the same shape as `value`, derived from `key`. Always the same
   * for the same key, and different from `value` whenever that is possible.
   */
  function generate(kind, value, key) {
    const rng = prng(key);
    let out = value;
    for (let attempt = 0; attempt < 16 && out === value; attempt++) {
      out = genOnce(kind, value, rng);
    }
    return out;
  }

  function randomSeed() {
    const bytes = new Uint8Array(8);
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Does `text` fit the template exactly (fixed parts and wildcard classes)?
  function fitsTemplate(text, segs, ci) {
    const src = segs.map((s) => (s.type === 'lit' ? literalPattern(s.text, ci) : PLACEHOLDERS[s.kind].pattern)).join('');
    return new RegExp('^(?:' + src + ')$', 'u').test(text);
  }

  // A wildcard rule may also be written "example -> template": the keyword holds
  // a concrete value (anImportantId: "1234454") and only the replacement has the
  // wildcards (anImportantId: "%i"). If the example fits the replacement's
  // shape, the rule matches like the template on both sides.
  //
  // Returns { fromSegs, toSegs, derived, warning } for a rule with the pattern flag set.
  function resolveTemplates(r) {
    let fromSegs = parseTemplate(r.keyword);
    const toSegs = parseTemplate(r.replacement);
    let derived = false;
    let warning = null;
    if (placeholderKinds(fromSegs).length === 0 && placeholderKinds(toSegs).length > 0) {
      const example = renderLiteral(fromSegs);
      if (example.length > 0 && fitsTemplate(example, toSegs, !!r.caseInsensitive)) {
        fromSegs = toSegs;
        derived = true;
      } else if (example.length > 0) {
        warning = 'The replacement has wildcards but the keyword has none, and the keyword does not fit the replacement\'s shape. Put the wildcards into the keyword (e.g. ' + renderLiteral(toSegs) + '), or make the keyword an example of that shape.';
      }
    }
    return { fromSegs, toSegs, derived, warning };
  }

  /**
   * How a rule is interpreted, for display in the UI.
   * @returns {{ matches: string|null, derived: boolean, warning: string|null }}
   *   matches = the effective keyword template (null for literal rules).
   */
  function describeRule(r) {
    if (!r || !r.pattern) return { matches: null, derived: false, warning: null };
    const t = resolveTemplates(r);
    const matches = placeholderKinds(t.fromSegs).length ? renderLiteral(t.fromSegs) : null;
    return { matches, derived: t.derived, warning: t.warning };
  }

  // ---------- Template suggestion ----------
  // Guess a wildcard template for a selected value, e.g. "21.0" -> "%d",
  // "BB12345678" -> "BB%i", "192.168.1.7" -> "%i.%i.%i.%i", "3fa9c0de" -> "%x",
  // "anna.berger@example.com" -> "%s.%s@%s.%s". Returns null when a literal
  // keyword is the better choice (plain words, names).
  function suggestTemplate(text) {
    const s = typeof text === 'string' ? text.trim() : '';
    if (!s || /[\n%]/.test(s)) return null;
    if (/^-?[0-9]+[.,][0-9]+$/.test(s) || /^-[0-9]+$/.test(s)) return '%d';
    if (/^[0-9]+$/.test(s)) return '%i';
    // Hex: only hex chars, letters and digits interleaved (at least 3 runs), so a
    // prefix + number like "BB12345678" is not mistaken for hex.
    if (/^[0-9a-fA-F]+$/.test(s) && s.length >= 4 && (s.match(/[0-9]+|[a-fA-F]+/g) || []).length >= 3) return '%x';
    const runs = s.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu) || [];
    const hasDigits = /[0-9]/.test(s);
    const hasSeparators = runs.some((r) => !/^[\p{L}\p{N}]+$/u.test(r));
    if (!hasDigits && !hasSeparators) return null; // a single word: keep it literal
    if (!hasDigits && !/[@./_\-:]/.test(s)) return null; // "Anna Berger": names stay literal
    let out = '';
    for (const r of runs) {
      let m;
      if (!/^[\p{L}\p{N}]+$/u.test(r)) out += r.replace(/%/g, '%%');
      else if (/^[0-9]+$/.test(r)) out += '%i';
      else if (/^\p{L}+$/u.test(r)) out += hasDigits ? r : '%s'; // letters next to digits are a prefix like "BB"
      else if ((m = /^(\p{L}+)([0-9]+)$/u.exec(r))) out += m[1] + '%i'; // "BB12345678" -> BB%i
      else out += '%a'; // truly mixed, e.g. "A7K2"
    }
    return out === s ? null : out;
  }

  // ---------- Compilation ----------
  function prepareRule(r, index, reverse) {
    const ci = !!r.caseInsensitive;
    const ww = !!r.wholeWord;
    let fromSegs;
    let toSegs;
    if (r.pattern) {
      ({ fromSegs, toSegs } = resolveTemplates(r));
    } else {
      fromSegs = [{ type: 'lit', text: typeof r.keyword === 'string' ? r.keyword : '' }];
      toSegs = [{ type: 'lit', text: typeof r.replacement === 'string' ? r.replacement : '' }];
    }
    const kinds = placeholderKinds(fromSegs);
    if (kinds.length === 0) {
      // No wildcards on the keyword side: behaves like a literal rule (and can be reversed).
      let from = renderLiteral(fromSegs);
      let to = renderLiteral(toSegs);
      if (reverse) { const t = from; from = to; to = t; }
      if (from.length === 0) return null;
      return { kind: 'literal', from, to, ci, ww, ruleIndex: index };
    }
    if (reverse) return null; // random values are only reversed through mappings
    return {
      kind: 'pattern',
      fromSegs,
      toSegs,
      kinds,
      keywordText: r.keyword,
      seedIncludesText: !!r.seedIncludesText,
      ci,
      ww,
      ruleIndex: index,
    };
  }

  /**
   * @param {Array} rules
   * @param {Object} opts { longestFirst, reverse, seed, mappings }
   *   reverse=true swaps keyword/replacement (used for de-anonymizing); pattern rules
   *   are then replaced by the stored mappings (to -> from).
   * @returns {{ regex: RegExp|null, entries: Array }}
   */
  function compile(rules, opts) {
    opts = opts || {};
    const literals = [];
    const patterns = [];
    (rules || []).forEach((r, i) => {
      const e = prepareRule(r, i, !!opts.reverse);
      if (!e) return;
      (e.kind === 'literal' ? literals : patterns).push(e);
    });
    if (opts.reverse) {
      const seen = new Set(literals.map((e) => e.from));
      for (const m of opts.mappings || []) {
        if (!m || typeof m.to !== 'string' || typeof m.from !== 'string' || m.to.length === 0) continue;
        if (seen.has(m.to)) continue; // rules win over mappings; first mapping wins
        seen.add(m.to);
        literals.push({ kind: 'literal', from: m.to, to: m.from, ci: false, ww: false, ruleIndex: -1 });
      }
    }
    if (opts.longestFirst) {
      // Stable sort: longer source strings first, otherwise keep list order.
      literals.sort((a, b) => b.from.length - a.from.length);
    }
    // Literal rules always take precedence over pattern rules; patterns keep list order.
    const entries = literals.concat(patterns);
    if (entries.length === 0) return { regex: null, entries: [] };

    let group = 0;
    const alternatives = entries.map((e) => {
      e.start = group; // index of this entry's outer capture group (0-based among groups)
      let pat;
      if (e.kind === 'literal') {
        pat = literalPattern(e.from, e.ci);
        const chars = [...e.from];
        if (e.ww) pat = wrapWholeWord(pat, isWordChar(chars[0]), isWordChar(chars[chars.length - 1]));
        e.size = 1;
      } else {
        pat = e.fromSegs
          .map((s) => (s.type === 'lit' ? literalPattern(s.text, e.ci) : '(' + PLACEHOLDERS[s.kind].pattern + ')'))
          .join('');
        if (e.ww) {
          const first = e.fromSegs[0];
          const last = e.fromSegs[e.fromSegs.length - 1];
          const edge = (seg, atStart) => {
            if (seg.type === 'ph') return true;
            const chars = [...seg.text];
            return isWordChar(atStart ? chars[0] : chars[chars.length - 1]);
          };
          pat = wrapWholeWord(pat, edge(first, true), edge(last, false));
        }
        e.size = 1 + e.kinds.length;
      }
      group += e.size;
      return '(' + pat + ')';
    });
    const regex = new RegExp(alternatives.join('|'), 'gu');
    return { regex, entries };
  }

  function renderPattern(e, values, seed) {
    let k = 0;
    let out = '';
    for (const s of e.toSegs) {
      if (s.type === 'lit') { out += s.text; continue; }
      if (k < values.length) {
        const context = e.seedIncludesText ? e.keywordText : null;
        out += generate(e.kinds[k], values[k], seedKey(seed, values[k], context));
        k++;
      } else {
        out += '%' + s.kind; // more wildcards in the replacement than in the keyword
      }
    }
    return out;
  }

  /**
   * @returns {{ text: string, count: number, counts: number[], mappings: Array<{from, to}> }}
   *   counts[i] = matches of rules[i]; mappings = pattern replacements made in this run.
   */
  function apply(text, rules, opts) {
    opts = opts || {};
    const counts = (rules || []).map(() => 0);
    const { regex, entries } = compile(rules, opts);
    if (!regex) return { text, count: 0, counts, mappings: [] };
    let count = 0;
    const mappings = [];
    const seenFrom = new Set();
    const out = text.replace(regex, function () {
      // arguments: match, g1..gN, offset, string, [groups]
      const match = arguments[0];
      for (const e of entries) {
        if (arguments[e.start + 1] === undefined) continue;
        count++;
        if (e.ruleIndex >= 0) counts[e.ruleIndex]++;
        if (e.kind === 'literal') return e.to;
        const values = [];
        for (let j = 1; j < e.size; j++) values.push(arguments[e.start + 1 + j]);
        const rendered = renderPattern(e, values, opts.seed);
        if (!seenFrom.has(match)) {
          seenFrom.add(match);
          mappings.push({ from: match, to: rendered });
        }
        return rendered;
      }
      return match;
    });
    return { text: out, count, counts, mappings };
  }

  function anonymize(text, rules, opts) {
    return apply(text, rules, Object.assign({}, opts, { reverse: false }));
  }

  function deanonymize(text, rules, opts) {
    return apply(text, rules, Object.assign({}, opts, { reverse: true }));
  }

  return { anonymize, deanonymize, compile, escapeRegex, parseTemplate, describeRule, suggestTemplate, generate, randomSeed, PLACEHOLDERS };
});
