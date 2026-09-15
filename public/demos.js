'use strict';
// Demo workspaces shown in every browser until the user hides them. They are
// inserted into the state on load (when missing), can be edited like any other
// workspace, and "Delete" only hides them (state.workspaces[i].hidden = true).
// Fixed ids and seeds keep them recognizable and their random values reproducible.
//
// Exposed as a function so every call yields fresh objects.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Demos = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function demoWorkspaces() {
    return [
      {
        id: 'demo-1-basics',
        demo: true,
        name: 'Demo 1 – Basics',
        longestFirst: true,
        persistTexts: true,
        seed: 'demo1-basics-seed',
        rules: [
          { keyword: 'Anna Berger', replacement: 'PERSON_1', wholeWord: true },
          { keyword: 'Anna', replacement: 'PERSON_1_FIRSTNAME', wholeWord: true },
          { keyword: 'Acme GmbH', replacement: 'COMPANY_1', caseInsensitive: true },
          { keyword: 'Berlin', replacement: 'CITY_1', wholeWord: true },
        ],
        texts: {
          anonymize: {
            input: [
              'Hi Anna,',
              '',
              'thanks for meeting us at Acme GmbH yesterday. Anna Berger will send the',
              'signed contract to the Berlin office next week; the ACME GMBH team in',
              'Berlin-Mitte reads the Berliner Zeitung and will confirm.',
              '',
              'Best regards',
            ].join('\n'),
          },
        },
        help: [
          'Plain keywords. "Longest keyword first" (header) makes "Anna Berger" win over "Anna".',
          '"Whole word" keeps "Berlin" from matching inside "Berliner"; "Case-insensitive" catches "ACME GMBH" (restored as "Acme GmbH", the keyword\'s spelling).',
          'Switch to De-anonymize and paste the result to get the original back.',
        ],
      },
      {
        id: 'demo-2-wildcards',
        demo: true,
        name: 'Demo 2 – Wildcards (JSON)',
        longestFirst: true,
        persistTexts: true,
        seed: 'demo2-wildcards-seed',
        rules: [
          { keyword: '"price": %d', replacement: '"price": %d', pattern: true },
          { keyword: '"orderId": "1234454"', replacement: '"orderId": "%i"', pattern: true },
          { keyword: '"customer": "%s %s"', replacement: '"customer": "%s %s"', pattern: true },
          { keyword: 'BB%i', replacement: 'BB%i', pattern: true },
          { keyword: 'CC%i', replacement: 'CC%i', pattern: true, seedIncludesText: true },
        ],
        texts: {
          anonymize: {
            input: [
              '{',
              '  "orderId": "1234454",',
              '  "customer": "Anna Berger",',
              '  "price": 21.0,',
              '  "items": [',
              '    { "sku": "BB12345678", "price": 4.5 },',
              '    { "sku": "CC12345678", "price": 16.5 }',
              '  ],',
              '  "note": "BB12345678 was reordered"',
              '}',
            ].join('\n'),
          },
        },
        help: [
          'Wildcard rules: %d number, %i digits, %s letters. Each matched value becomes a random value of the same shape.',
          '"orderId" is written as example → template: the keyword holds a real value, only the replacement has the wildcard.',
          'BB and CC share the same digits; CC has "Text in seed" on and therefore gets different digits than BB.',
          'The mappings section below records every replacement so De-anonymize can restore the original.',
        ],
      },
      {
        id: 'demo-3-logfile',
        demo: true,
        name: 'Demo 3 – Log file',
        longestFirst: true,
        persistTexts: true,
        seed: 'demo3-logfile-seed',
        rules: [
          { keyword: 'Anna Berger', replacement: 'PERSON_1', wholeWord: true },
          { keyword: 'Acme', replacement: 'COMPANY_1', caseInsensitive: true, wholeWord: true },
          { keyword: '%i.%i.%i.%i', replacement: '%i.%i.%i.%i', pattern: true },
          { keyword: '%s.%s@%s.%s', replacement: '%s.%s@%s.%s', pattern: true },
          { keyword: '%s@%s.%s', replacement: '%s@%s.%s', pattern: true },
          { keyword: 'user=%s', replacement: 'user=%s', pattern: true },
          { keyword: 'session=%x', replacement: 'session=%x', pattern: true },
          { keyword: 'contract #%a-%a', replacement: 'contract #%a-%a', pattern: true },
        ],
        texts: {
          anonymize: {
            input: [
              '2026-09-15 10:12:01 INFO  login user=aberger from 192.168.178.42 session=3fa9c0de',
              '2026-09-15 10:12:07 INFO  mail sent to anna.berger@example.com (cc support@acme.de)',
              '2026-09-15 10:13:44 WARN  Anna Berger exceeded the ACME quota; see contract #A7K2-99X',
              '2026-09-15 10:14:02 INFO  logout user=aberger session=3fa9c0de',
              '2026-09-15 10:15:30 INFO  login user=mmeier from 10.0.0.7 session=00ff12ab',
            ].join('\n'),
          },
        },
        help: [
          'Several wildcards per rule: IP addresses (%i.%i.%i.%i), e-mail addresses, hex session ids (%x), mixed ids (%a-%a).',
          'Plain keywords (Anna Berger, Acme) always take precedence over wildcard rules; wildcard rules apply in list order, so the 4-part e-mail pattern is listed before the 3-part one.',
          'The same session id appears twice and gets the same random value both times.',
        ],
      },
    ];
  }

  return { demoWorkspaces };
});
