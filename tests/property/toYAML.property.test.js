// Property-based round-trip tests for toYAML.
//
// The law: parsing what toYAML emits gives back what went in, modulo the two
// null spellings the contract fixes in place (see `expectedParse` below). This
// is what catches serializer holes mechanically — the leading-`-` and nested
// collection bugs were both found this way rather than by inspection.
//
// js-yaml is a TEST ORACLE ONLY. The plugin itself stays zero-dependency; this
// must never be imported by index.js.
//
// Oracle caveat: js-yaml implements YAML 1.2, where `yes`/`no`/`on`/`off` are
// plain strings. The consumer is Python/PyYAML, which is YAML 1.1 and reads
// them as booleans. The oracle therefore cannot see that class of bug, so
// those are pinned by explicit example in tests/unit/toYAML.contract.test.js.

const fc = require('fast-check');
const yaml = require('js-yaml');
const { toYAML } = require('../../index.js');

// Reproducible in CI, freshly random locally — a failure prints its seed.
if (process.env.CI) fc.configureGlobal({ seed: 42 });

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * What a YAML parser should yield for `value`, given the serializer's two
 * documented null behaviours:
 *
 *   - in a mapping, a null-valued key is dropped entirely;
 *   - in an object that is directly a list item, it is written as `k: null`.
 *
 * A mapping whose keys all drop emits `{}` at the root, so a file is always a
 * well-formed document (D65); nested, it emits nothing and the parent renders
 * `key:` with nothing under it, which parses as null.
 */
function expectedParse(value, isListItem = false, isRoot = true) {
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : value.map((item) => expectedParse(item, true, false));
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return {};

    const out = {};
    let emitted = 0;
    for (const [k, v] of entries) {
      if (v === null || v === undefined) {
        if (!isListItem) continue;   // dropped from mappings
        out[k] = null;               // kept in list items
        emitted++;
        continue;
      }
      out[k] = expectedParse(v, false, false);
      emitted++;
    }
    if (emitted > 0) return out;
    // Every key dropped. At the root that is written as `{}` so the file stays
    // a well-formed document (D65); nested, the parent emits a bare `key:`
    // with nothing under it, which parses as null.
    return isRoot ? {} : null;
  }
  return value;
}

/** JSON-ish values: what the transformers actually build. */
const scalar = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0)),
  fc.boolean(),
  fc.constant(null),
);

// `__proto__` is excluded because assigning it on a plain JS object mutates the
// prototype instead of creating a key — a JavaScript object-model artifact in
// the test's own comparison, not anything YAML does.
const key = fc.string({ minLength: 1 }).filter((k) => k !== '__proto__');

const jsonish = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    scalar,
    tie('list'),
    tie('mapping'),
  ),
  list: fc.array(tie('value'), { maxLength: 5 }),
  mapping: fc.dictionary(key, tie('value'), { maxKeys: 5 }),
})).value;

describe('toYAML round-trip law', () => {
  test('any JSON-ish value survives a parse, modulo the documented null spellings', () => {
    fc.assert(
      fc.property(jsonish, (value) => {
        const emitted = toYAML(value);
        expect(yaml.load(emitted) ?? null).toEqual(expectedParse(value) ?? null);
      }),
      { numRuns: 500 },
    );
  });

  // No carve-out any more. A root mapping whose keys all drop is written as
  // `{}` (D65), so every value this serializer produces at the root is a
  // well-formed document — previously an all-dropped mapping emitted nothing,
  // and an empty file does not parse.
  test('emitted YAML always parses', () => {
    fc.assert(
      fc.property(jsonish, (value) => {
        const emitted = toYAML(value);
        expect(emitted).not.toBe('');
        expect(() => yaml.load(emitted)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  test('top-level mappings round-trip with arbitrary keys', () => {
    fc.assert(
      fc.property(fc.dictionary(key, scalar, { maxKeys: 8 }), (obj) => {
        const parsed = yaml.load(toYAML(obj)) ?? {};
        expect(parsed).toEqual(expectedParse(obj) ?? {});
      }),
      { numRuns: 500 },
    );
  });

  test('lists of entry objects round-trip regardless of key order', () => {
    // Uses the filtered `key` for the same reason as the generators above:
    // `__proto__` is a JS object-model artifact in the comparison, not YAML.
    const entry = fc.dictionary(key, fc.oneof(scalar, fc.array(scalar, { maxLength: 3 })), {
      minKeys: 1,
      maxKeys: 5,
    });
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 4 }), (entries) => {
        expect(yaml.load(toYAML(entries))).toEqual(expectedParse(entries));
      }),
      { numRuns: 500 },
    );
  });

  test('indentation is stable under nesting depth', () => {
    fc.assert(
      fc.property(jsonish, fc.integer({ min: 0, max: 4 }), (value, indent) => {
        const emitted = toYAML(value, indent);
        // The `{}` guarantee is root-only by design, and rendering at a deeper
        // indent is not the root — an all-dropped mapping still emits nothing
        // there, which is the nested spelling the consumer reads as null.
        fc.pre(emitted !== '');
        // Rendering deeper only shifts the block; it must still parse alone.
        const dedented = emitted
          .split('\n')
          .map((line) => line.slice(indent * 2))
          .join('\n');
        expect(yaml.load(dedented) ?? null).toEqual(expectedParse(value) ?? null);
      }),
      { numRuns: 300 },
    );
  });
});
