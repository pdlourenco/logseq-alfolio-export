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
 * A mapping whose keys all drop emits no lines at all, so its parent renders
 * `key:` with nothing under it, which parses as null. That is pre-existing
 * behaviour, modelled here rather than changed.
 */
function expectedParse(value, isListItem = false) {
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : value.map((item) => expectedParse(item, true));
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
      out[k] = expectedParse(v, false);
      emitted++;
    }
    // Every key dropped → the parent emits a bare `key:` → parses as null.
    return emitted === 0 ? null : out;
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
        const expected = expectedParse(value);
        if (emitted === '') {
          // An all-dropped mapping emits nothing — see the carve-out below.
          expect(expected).toBeNull();
          return;
        }
        expect(yaml.load(emitted) ?? null).toEqual(expected ?? null);
      }),
      { numRuns: 500 },
    );
  });

  // The one carve-out: a mapping whose keys all drop emits nothing at all, and
  // an empty document is not parseable. That is pre-existing behaviour and it
  // is reachable — a missing CV/Profile page makes every profile field null, so
  // profile.yml comes out empty rather than as `{}`. Changing it is a shape
  // decision (empty file vs. empty mapping), so it is flagged for PR 2.5 rather
  // than quietly altered here. Everything that emits anything must parse.
  test('emitted YAML always parses, unless every key dropped', () => {
    fc.assert(
      fc.property(jsonish, (value) => {
        const emitted = toYAML(value);
        fc.pre(emitted !== '');
        expect(() => yaml.load(emitted)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  test('top-level mappings round-trip with arbitrary keys', () => {
    fc.assert(
      fc.property(fc.dictionary(key, scalar, { maxKeys: 8 }), (obj) => {
        const emitted = toYAML(obj);
        const parsed = emitted === '' ? {} : (yaml.load(emitted) ?? {});
        expect(parsed).toEqual(expectedParse(obj) ?? {});
      }),
      { numRuns: 500 },
    );
  });

  test('lists of entry objects round-trip regardless of key order', () => {
    const entry = fc.dictionary(fc.string({ minLength: 1 }), fc.oneof(scalar, fc.array(scalar, { maxLength: 3 })), {
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
