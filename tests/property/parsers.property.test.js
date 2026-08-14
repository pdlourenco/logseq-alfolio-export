// Property-based tests for the pure property parsers.
//
// These functions are fed whatever Logseq hands the plugin, and `seed.md` is
// explicit that the shapes are guesses. So the properties asserted here are the
// ones that must hold for ANY input, not for the shapes we expect: total
// functions that never throw, and postconditions each parser's own contract
// implies. A parser that throws takes the whole export down with it.

const fc = require('fast-check');
const {
  stripBrackets,
  extractRefs,
  convertDate,
  parseCommaSeparatedRefs,
  parsePeopleRefs,
  parseMarkdownLink,
  extractBlockTitle,
} = require('../../index.js');

if (process.env.CI) fc.configureGlobal({ seed: 42 });

/** Anything that could arrive from a property map, not just well-formed input. */
const anyValue = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.string(), { maxLength: 3 }),
  fc.dictionary(fc.string(), fc.string(), { maxKeys: 3 }),
);

/** Strings biased toward the syntax these parsers actually care about. */
const refish = fc.stringMatching(/^[a-zA-Z0-9 .,()[\]/:&-]{0,40}$/);

const PARSERS = {
  stripBrackets,
  extractRefs,
  convertDate,
  parseCommaSeparatedRefs,
  parsePeopleRefs,
  parseMarkdownLink,
  extractBlockTitle,
};

describe('parsers are total', () => {
  test.each(Object.keys(PARSERS))('%s never throws on arbitrary input', (name) => {
    fc.assert(
      fc.property(anyValue, (value) => {
        expect(() => PARSERS[name](value)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });

  test.each(Object.keys(PARSERS))('%s never throws on ref-shaped strings', (name) => {
    fc.assert(
      fc.property(refish, (value) => {
        expect(() => PARSERS[name](value)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });
});

describe('stripBrackets', () => {
  test('is idempotent on well-formed refs', () => {
    fc.assert(
      fc.property(refish, (s) => {
        const once = stripBrackets(s);
        expect(stripBrackets(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  test('removes any complete [[ref]] it is given', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-zA-Z0-9 ]{1,20}$/), (inner) => {
        expect(stripBrackets(`[[${inner}]]`)).toBe(inner);
      }),
      { numRuns: 300 },
    );
  });

  test('passes non-strings through untouched', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)), (v) => {
        expect(stripBrackets(v)).toBe(v);
      }),
      { numRuns: 100 },
    );
  });
});

describe('extractRefs', () => {
  test('always returns an array', () => {
    fc.assert(
      fc.property(anyValue, (v) => {
        expect(Array.isArray(extractRefs(v))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  test('no extracted ref contains bracket syntax', () => {
    fc.assert(
      fc.property(refish, (s) => {
        for (const ref of extractRefs(s)) {
          expect(ref).not.toMatch(/\[\[|\]\]/);
        }
      }),
      { numRuns: 500 },
    );
  });

  test('finds each ref in a generated list of them', () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-zA-Z0-9 ]{1,15}$/), { minLength: 1, maxLength: 4 }), (names) => {
        const refs = extractRefs(names.map((n) => `[[${n}]]`).join(', '));
        expect(refs).toEqual(names);
      }),
      { numRuns: 300 },
    );
  });
});

describe('convertDate', () => {
  // Note: the postcondition is that no *complete* ref survives. A stray `]]`
  // with no opening pair is left alone by stripBrackets, which is correct —
  // asserting "no bracket characters at all" was too strong and this test said
  // so on its ninth case.
  test('output never contains a slash or a complete ref', () => {
    fc.assert(
      fc.property(refish, (s) => {
        const out = convertDate(s);
        if (typeof out === 'string') {
          expect(out).not.toContain('/');
          expect(out).not.toMatch(/\[\[[^\]]*\]\]/);
        }
      }),
      { numRuns: 500 },
    );
  });

  test('converts well-formed Logseq dates to the exported spelling', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1900, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (y, m, d) => {
          const mm = String(m).padStart(2, '0');
          const dd = String(d).padStart(2, '0');
          expect(convertDate(`[[${y}]]`)).toBe(`${y}`);
          expect(convertDate(`[[${y}/${mm}]]`)).toBe(`${y}-${mm}`);
          expect(convertDate(`[[${y}/${mm}/${dd}]]`)).toBe(`${y}-${mm}-${dd}`);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('parseCommaSeparatedRefs', () => {
  test('always returns an array of non-empty trimmed strings', () => {
    fc.assert(
      fc.property(refish, (s) => {
        const out = parseCommaSeparatedRefs(s);
        expect(Array.isArray(out)).toBe(true);
        for (const item of out) {
          expect(item).toBe(item.trim());
          expect(item).not.toBe('');
        }
      }),
      { numRuns: 500 },
    );
  });

  test('never returns more items than there are separators', () => {
    fc.assert(
      fc.property(refish, (s) => {
        expect(parseCommaSeparatedRefs(s).length).toBeLessThanOrEqual(s.split(',').length);
      }),
      { numRuns: 500 },
    );
  });
});

describe('parsePeopleRefs', () => {
  test('every element has string title and name', () => {
    fc.assert(
      fc.property(refish, (s) => {
        for (const person of parsePeopleRefs(s)) {
          expect(typeof person.title).toBe('string');
          expect(typeof person.name).toBe('string');
          expect(person.name).not.toMatch(/\[\[[^\]]*\]\]/);
        }
      }),
      { numRuns: 500 },
    );
  });

  test('splits titled refs into title and name', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Prof.', 'Dr.', 'Eng.'),
        fc.stringMatching(/^[a-zA-Z][a-zA-Z ]{1,20}$/),
        (title, name) => {
          expect(parsePeopleRefs(`${title} [[${name}]]`)).toEqual([{ title, name }]);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('parseMarkdownLink', () => {
  test('returns null or a {label, url} pair, never anything else', () => {
    fc.assert(
      fc.property(refish, (s) => {
        const out = parseMarkdownLink(s);
        if (out !== null) {
          expect(Object.keys(out).sort()).toEqual(['label', 'url']);
          expect(typeof out.label).toBe('string');
          expect(typeof out.url).toBe('string');
        }
      }),
      { numRuns: 500 },
    );
  });

  test('round-trips a well-formed link', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9 ]{0,20}$/),
        fc.stringMatching(/^[a-zA-Z0-9:/._-]{1,30}$/),
        (label, url) => {
          expect(parseMarkdownLink(`[${label}](${url})`)).toEqual({ label, url });
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('extractBlockTitle', () => {
  test('always returns a string, never a property line', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = extractBlockTitle(s);
        expect(typeof out).toBe('string');
        expect(out).not.toMatch(/^[a-z][-a-z]*::/);
      }),
      { numRuns: 500 },
    );
  });

  test('skips leading property lines to find the title', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][a-zA-Z ]{1,20}$/),
        fc.array(fc.stringMatching(/^[a-z][a-z-]{1,10}$/), { maxLength: 3 }),
        (title, propKeys) => {
          const content = [`- ${title}`, ...propKeys.map((k) => `  ${k}:: value`)].join('\n');
          // The title is trimmed on the way out, by design.
          expect(extractBlockTitle(content)).toBe(title.trim());
        },
      ),
      { numRuns: 300 },
    );
  });
});
