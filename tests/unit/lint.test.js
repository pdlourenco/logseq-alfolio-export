// Every lint rule, each with an input that trips it and an input that doesn't.
// The lint reports and never fails the export, so these also assert that a
// warning is produced rather than thrown.

const { ExportLint, ResolutionCache } = require('../../index.js');

/** A cache standing in for a graph containing exactly the named pages/people. */
function fakeCache({ pages = [], people = {} } = {}) {
  const cache = new ResolutionCache();
  for (const name of pages) {
    cache.pageCache[name.toLowerCase()] = { originalName: name, properties: {} };
  }
  for (const [name, affiliation] of Object.entries(people)) {
    cache.pageCache[name.toLowerCase()] = { originalName: name, properties: {} };
    cache.affiliationMap[name.toLowerCase()] = { affiliation, abbreviation: affiliation };
  }
  return cache;
}

const rules = (lint) => lint.warnings.map((w) => w.rule);

describe('unresolved-ref', () => {
  test('warns when a [[ref]] matches no page', () => {
    const lint = new ExportLint(fakeCache({ pages: ['Orbital Systems'] }));
    lint.checkEntry({ _blockContent: '- Engineer', type: 'experience', organization: '[[Nowhere]]' });
    expect(rules(lint)).toContain('unresolved-ref');
    expect(lint.warnings.find((w) => w.rule === 'unresolved-ref').message).toMatch(/\[\[Nowhere\]\]/);
  });

  test('does not warn when the ref resolves', () => {
    const lint = new ExportLint(fakeCache({ pages: ['Orbital Systems'] }));
    lint.checkEntry({ _blockContent: '- Engineer', type: 'experience', organization: '[[Orbital Systems]]' });
    expect(rules(lint)).not.toContain('unresolved-ref');
  });

  test('resolves through an alias', () => {
    const cache = fakeCache({ pages: ['Universidade do Exemplo'] });
    cache.aliasMap['udex'] = 'Universidade do Exemplo';
    const lint = new ExportLint(cache);
    lint.checkEntry({ _blockContent: '- Degree', university: '[[UDEX]]' });
    expect(rules(lint)).not.toContain('unresolved-ref');
  });
});

// Fixture names are synthetic per the roadmap's standing decision. Provenance:
// this is the Gil Serrano case from seed.md P1, where the source graph had the
// supervisor's affiliation baked into the page ref.
describe('ref-parentheses', () => {
  test('warns when an affiliation is baked into the link', () => {
    const lint = new ExportLint(fakeCache());
    lint.checkEntry({
      _blockContent: '- Tomás Aguiar',
      type: 'student',
      supervisor: 'Prof. [[Helena Duarte (UDEX)]]',
    });
    expect(rules(lint)).toContain('ref-parentheses');
  });

  test('does not warn on a clean person ref', () => {
    const lint = new ExportLint(fakeCache({ people: { 'Helena Duarte': 'UDEX' } }));
    lint.checkEntry({
      _blockContent: '- Tomás Aguiar',
      type: 'student',
      supervisor: 'Prof. [[Helena Duarte]]',
      university: '[[Helena Duarte]]',
    });
    expect(rules(lint)).not.toContain('ref-parentheses');
  });
});

describe('bad-date', () => {
  test.each([
    ['2022-07-15', 'hyphens instead of slashes'],
    ['July 2022', 'prose'],
    ['22/07', 'two-digit year'],
  ])('warns on %s (%s)', (value) => {
    const lint = new ExportLint(fakeCache());
    lint.checkEntry({ _blockContent: '- Thing', start: `[[${value}]]` });
    expect(rules(lint)).toContain('bad-date');
  });

  test.each(['2022', '2022/07', '2022/07/15'])('accepts %s', (value) => {
    const lint = new ExportLint(fakeCache());
    lint.checkEntry({ _blockContent: '- Thing', start: `[[${value}]]` });
    expect(rules(lint)).not.toContain('bad-date');
  });

  test('ignores a missing date rather than warning', () => {
    const lint = new ExportLint(fakeCache());
    lint.checkEntry({ _blockContent: '- Thing' });
    expect(rules(lint)).not.toContain('bad-date');
  });
});

describe('missing-property', () => {
  test('warns when a typed entry lacks a property it needs', () => {
    const lint = new ExportLint(fakeCache({ pages: ['Orbital Systems'] }));
    lint.checkEntry({ _blockContent: '- Engineer', type: 'experience', organization: '[[Orbital Systems]]' });
    // experience needs position and start as well
    const missing = lint.warnings.filter((w) => w.rule === 'missing-property');
    expect(missing.length).toBe(2);
    expect(missing.map((w) => w.message).join(' ')).toMatch(/position/);
    expect(missing.map((w) => w.message).join(' ')).toMatch(/start/);
  });

  test('does not warn when every required property is present', () => {
    const lint = new ExportLint(fakeCache({ pages: ['Orbital Systems'] }));
    lint.checkEntry({
      _blockContent: '- Engineer',
      type: 'experience',
      position: 'Engineer',
      organization: '[[Orbital Systems]]',
      start: '[[2020/01]]',
    });
    expect(rules(lint)).not.toContain('missing-property');
  });

  test('says nothing about a type it has no rules for', () => {
    const lint = new ExportLint(fakeCache());
    lint.checkEntry({ _blockContent: '- Thing', type: 'person' });
    expect(rules(lint)).not.toContain('missing-property');
  });
});

describe('unknown-supervisor', () => {
  test('warns when a supervisor has no person page', () => {
    const lint = new ExportLint(fakeCache());
    lint.checkEntry({
      _blockContent: '- Ana',
      type: 'student',
      supervisor: 'Prof. [[Nobody Known]]',
      university: '[[UDEX]]',
    });
    expect(rules(lint)).toContain('unknown-supervisor');
  });

  test('does not warn when the person page carries an affiliation', () => {
    const lint = new ExportLint(fakeCache({
      people: { 'Miguel Antunes': 'Universidade do Exemplo' },
      pages: ['UDEX'],
    }));
    lint.checkEntry({
      _blockContent: '- Ana',
      type: 'student',
      supervisor: 'Prof. [[Miguel Antunes]]',
      university: '[[UDEX]]',
    });
    expect(rules(lint)).not.toContain('unknown-supervisor');
  });

  test('only applies to students', () => {
    const lint = new ExportLint(fakeCache());
    lint.checkEntry({ _blockContent: '- X', type: 'project', supervisor: 'Prof. [[Nobody]]' });
    expect(rules(lint)).not.toContain('unknown-supervisor');
  });
});

describe('icons-used', () => {
  test('reports the set of icon keys, sorted and deduplicated', () => {
    const lint = new ExportLint(fakeCache());
    lint.checkAll([[
      { _blockContent: '- A', icon: 'up' },
      { _blockContent: '- B', icon: 'udex' },
      { _blockContent: '- C', icon: 'up' },
    ]]);
    const inventory = lint.warnings.find((w) => w.rule === 'icons-used');
    expect(inventory.message).toMatch(/udex, up/);
  });

  test('is omitted entirely when no icons are referenced', () => {
    const lint = new ExportLint(fakeCache());
    lint.checkAll([[{ _blockContent: '- A' }]]);
    expect(rules(lint)).not.toContain('icons-used');
  });

  test('is not counted as a problem', () => {
    const lint = new ExportLint(fakeCache());
    lint.checkAll([[{ _blockContent: '- A', icon: 'up' }]]);
    expect(lint.warnings.length).toBe(1);
    expect(lint.problems.length).toBe(0);
  });
});

describe('lint never throws', () => {
  test('tolerates entries with no content and odd property values', () => {
    const lint = new ExportLint(fakeCache());
    expect(() => lint.checkAll([
      [{}],
      [{ _blockContent: null, type: 42 }],
      [{ _blockContent: '- X', start: ['[[2020]]'] }],
      null,
      undefined,
    ])).not.toThrow();
  });

  test('handles both block shapes', () => {
    const lint = new ExportLint(fakeCache());
    lint.checkEntry({ properties: { type: 'experience' }, _blockContent: '- Nested' });
    lint.checkEntry({ type: 'experience', _blockContent: '- Flat' });
    expect(lint.warnings.filter((w) => w.rule === 'missing-property').length).toBeGreaterThan(0);
  });
});
