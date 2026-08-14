// Behaviours of toYAML that are pinned by example rather than by property.
//
// Two kinds live here:
//
//   1. The null spellings, which are CONTRACTUAL. Contract v1 accommodates both
//      and the site's transform treats them identically, so unifying them is a
//      breaking shape change that needs a schema_version bump. These tests exist
//      so a later tidy-up of the serializer cannot silently break the consumer —
//      they must pass before AND after any change to the quoting or indentation
//      logic.
//
//   2. Regression cases for each hole the round-trip law exposed. Every one of
//      these fails against the previous serializer.

const yaml = require('js-yaml');
const { toYAML } = require('../../index.js');

describe('null spellings (contractual — do not unify)', () => {
  test('a null-valued key is dropped from a mapping', () => {
    expect(toYAML({ a: null, b: 1 })).toBe('b: 1');
  });

  test('a null-valued key is emitted inside a list item', () => {
    expect(toYAML([{ a: 1, b: null }])).toBe('- a: 1\n  b: null');
  });

  test('undefined behaves as null in both positions', () => {
    expect(toYAML({ a: undefined, b: 1 })).toBe('b: 1');
    expect(toYAML([{ a: 1, b: undefined }])).toBe('- a: 1\n  b: null');
  });

  test('both spellings parse to the same absent-ish value', () => {
    expect(yaml.load(toYAML({ entries: [{ name: 'x', description: null }] })))
      .toEqual({ entries: [{ name: 'x', description: null }] });
    expect(yaml.load(toYAML({ github: { id: 'x', url: null } })))
      .toEqual({ github: { id: 'x' } });
  });
});

describe('structural regressions (unparseable before the fix)', () => {
  test('a nested array inside a list keeps its indentation', () => {
    expect(toYAML([[1, 2]])).toBe('- - 1\n  - 2');
    expect(yaml.load(toYAML([[1, 2]]))).toEqual([[1, 2]]);
  });

  test('a nested array under a mapping key parses', () => {
    expect(yaml.load(toYAML({ a: [[1, 2]] }))).toEqual({ a: [[1, 2]] });
  });

  test('a list item whose first key holds an array parses', () => {
    // Previously emitted `- items: - a`, a parse error. Key order alone decided
    // whether an export was readable.
    expect(yaml.load(toYAML([{ items: ['a'], name: 'Skills' }])))
      .toEqual([{ items: ['a'], name: 'Skills' }]);
  });

  test('a list item whose first key holds an object parses', () => {
    expect(yaml.load(toYAML([{ a: { b: 1 } }]))).toEqual([{ a: { b: 1 } }]);
  });

  test('key order does not affect the parsed result', () => {
    const a = yaml.load(toYAML([{ name: 'Skills', items: ['a'] }]));
    const b = yaml.load(toYAML([{ items: ['a'], name: 'Skills' }]));
    expect(a[0]).toEqual(b[0]);
  });
});

describe('quoting regressions (silent corruption before the fix)', () => {
  test('a leading dash does not become a nested list', () => {
    expect(yaml.load(toYAML(['- item']))).toEqual(['- item']);
  });

  test.each([
    ['ampersand (anchor)', '&anchor'],
    ['exclamation (tag)', '!tag'],
    ['pipe (block scalar)', '| pipe'],
    ['greater-than (folded scalar)', '> folded'],
    ['question mark (complex key)', '? key'],
    ['percent (directive)', '% directive'],
    ['backtick (reserved)', '`tick'],
    ['leading dot', '.inf'],
    ['leading plus', '+1'],
    ['comma', ',comma'],
  ])('%s survives as a string', (_label, value) => {
    expect(yaml.load(toYAML({ v: value }))).toEqual({ v: value });
  });

  test('leading and trailing whitespace is preserved', () => {
    expect(yaml.load(toYAML({ v: '  padded  ' }))).toEqual({ v: '  padded  ' });
  });

  // js-yaml is YAML 1.2 and reads these as strings, so the oracle cannot catch
  // this class. The consumer is Python/PyYAML — YAML 1.1 — where an unquoted
  // `yes` is boolean True. Asserting on the emitted text is the only check that
  // actually protects the consumer here.
  test.each(['yes', 'no', 'on', 'off', 'y', 'n', 'Yes', 'OFF', '~'])(
    'YAML 1.1 boolean %s is quoted for the Python consumer',
    (value) => {
      expect(toYAML({ v: value })).toBe(`v: ${JSON.stringify(value)}`);
    },
  );

  test('YAML 1.2 booleans and null are still quoted', () => {
    expect(toYAML({ v: 'true' })).toBe('v: "true"');
    expect(toYAML({ v: 'null' })).toBe('v: "null"');
  });
});

describe('mapping keys are quoted like values', () => {
  test('a key containing a colon parses as one key', () => {
    expect(yaml.load(toYAML({ 'a:b': 1 }))).toEqual({ 'a:b': 1 });
  });

  test('a numeric-looking key stays a string', () => {
    expect(yaml.load(toYAML({ '+0': 1 }))).toEqual({ '+0': 1 });
  });

  test('a key with a leading dash parses', () => {
    expect(yaml.load(toYAML({ '-key': 1 }))).toEqual({ '-key': 1 });
  });

  test('ordinary keys are left unquoted', () => {
    expect(toYAML({ research_interests: 1 })).toBe('research_interests: 1');
  });
});

describe('shapes that were already correct stay byte-identical', () => {
  test('a scalar-first entry object', () => {
    expect(toYAML([{ name: 'Skills', items: ['a'] }]))
      .toBe('- name: Skills\n  items:\n    - a');
  });

  test('empty collections', () => {
    expect(toYAML([])).toBe('[]');
    expect(toYAML({})).toBe('{}');
    expect(toYAML([{}])).toBe('- {}');
    expect(toYAML({ a: [] })).toBe('a: []');
  });

  test('nested mapping under a key', () => {
    expect(toYAML({ a: { b: 1 } })).toBe('a:\n  b: 1');
  });
});
