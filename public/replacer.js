'use strict';
// Pure search/replace engine. Works in the browser (global `Replacer`) and in Node (module.exports).
//
// A rule: { keyword, replacement, caseInsensitive, wholeWord }
// Options: { longestFirst }
//
// All rules are compiled into ONE alternation regex and applied in a single pass,
// so an output of one rule is never re-matched by another rule.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Replacer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WORD_CHAR = '[\\p{L}\\p{N}_]';

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

  function wrapWholeWord(pattern, text) {
    // Only guard an edge with a boundary if the text itself starts/ends with a word char;
    // otherwise "GmbH & Co." would never match because "." is not a word char.
    const first = [...text][0];
    const last = [...text].slice(-1)[0];
    const wordRe = new RegExp('^' + WORD_CHAR + '$', 'u');
    const pre = wordRe.test(first) ? '(?<!' + WORD_CHAR + ')' : '';
    const post = wordRe.test(last) ? '(?!' + WORD_CHAR + ')' : '';
    return pre + pattern + post;
  }

  /**
   * @param {Array} rules
   * @param {Object} opts { longestFirst, reverse }
   *   reverse=true swaps keyword/replacement (used for de-anonymizing).
   * @returns {{ regex: RegExp|null, targets: string[] }}
   */
  function compile(rules, opts) {
    opts = opts || {};
    const prepared = [];
    for (const r of rules || []) {
      const from = opts.reverse ? r.replacement : r.keyword;
      const to = opts.reverse ? r.keyword : r.replacement;
      if (typeof from !== 'string' || from.length === 0) continue;
      prepared.push({
        from,
        to: typeof to === 'string' ? to : '',
        caseInsensitive: !!r.caseInsensitive,
        wholeWord: !!r.wholeWord,
      });
    }
    if (opts.longestFirst) {
      // Stable sort: longer source strings first, otherwise keep list order.
      prepared.sort((a, b) => b.from.length - a.from.length);
    }
    if (prepared.length === 0) return { regex: null, targets: [] };

    const alternatives = prepared.map((p) => {
      let pat = literalPattern(p.from, p.caseInsensitive);
      if (p.wholeWord) pat = wrapWholeWord(pat, p.from);
      return '(' + pat + ')';
    });
    const regex = new RegExp(alternatives.join('|'), 'gu');
    return { regex, targets: prepared.map((p) => p.to) };
  }

  /**
   * @returns {{ text: string, count: number }}
   */
  function apply(text, rules, opts) {
    const { regex, targets } = compile(rules, opts);
    if (!regex) return { text, count: 0 };
    let count = 0;
    const out = text.replace(regex, function () {
      // arguments: match, g1..gN, offset, string, [groups]
      for (let i = 0; i < targets.length; i++) {
        if (arguments[i + 1] !== undefined) {
          count++;
          return targets[i];
        }
      }
      return arguments[0];
    });
    return { text: out, count };
  }

  function anonymize(text, rules, opts) {
    return apply(text, rules, Object.assign({}, opts, { reverse: false }));
  }

  function deanonymize(text, rules, opts) {
    return apply(text, rules, Object.assign({}, opts, { reverse: true }));
  }

  return { anonymize, deanonymize, compile, escapeRegex };
});
