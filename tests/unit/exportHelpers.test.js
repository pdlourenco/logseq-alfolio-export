// Unit tests for the PR 2 helpers: deterministic ordering, the site-name read,
// block-shape normalisation, and degree-suffix stripping.

const {
  cmpString,
  cmpDateDesc,
  sortKeys,
  sortExport,
  getWebsiteName,
  entryProps,
  stripDisambiguationSuffix,
  DEFAULT_WEBSITE_NAME,
} = require('../../index.js');

describe('cmpString', () => {
  test('orders by codepoint, not locale', () => {
    // localeCompare would order these differently depending on the machine's
    // locale, which is exactly the non-determinism this avoids.
    expect(['b', 'A', 'a', 'B'].sort(cmpString)).toEqual(['A', 'B', 'a', 'b']);
  });

  test('treats null and undefined as empty', () => {
    expect(cmpString(null, '')).toBe(0);
    expect(cmpString(undefined, 'a')).toBe(-1);
  });
});

describe('cmpDateDesc', () => {
  test('sorts newest first', () => {
    expect(['2020-01', '2024-06', '2022'].sort(cmpDateDesc)).toEqual(['2024-06', '2022', '2020-01']);
  });

  test('puts undated entries last in both argument orders', () => {
    expect(cmpDateDesc(null, '2020')).toBe(1);
    expect(cmpDateDesc('2020', null)).toBe(-1);
    expect(cmpDateDesc(null, null)).toBe(0);
  });

  test('compares mixed precisions lexicographically', () => {
    expect(['2022-01', '2022', '2022-01-05'].sort(cmpDateDesc))
      .toEqual(['2022-01-05', '2022-01', '2022']);
  });
});

describe('sortKeys', () => {
  test('returns a new object with keys in sorted order', () => {
    expect(Object.keys(sortKeys({ zebra: 1, apple: 2, mango: 3 })))
      .toEqual(['apple', 'mango', 'zebra']);
  });

  test('preserves values and leaves the input alone', () => {
    const input = { b: 1, a: 2 };
    const out = sortKeys(input);
    expect(out).toEqual({ a: 2, b: 1 });
    expect(Object.keys(input)).toEqual(['b', 'a']);
  });
});

describe('sortExport', () => {
  const makeCv = () => ({
    experience: [
      { position: 'Junior', organization: 'B', start: '2015-01' },
      { position: 'Senior', organization: 'A', start: '2020-06' },
      { position: 'Intern', organization: 'C', start: null },
    ],
    education: [
      { degree: 'BSc', start: '2010' },
      { degree: 'PhD', start: '2018' },
    ],
    awards: [{ title: 'B', date: '2019' }, { title: 'A', date: '2021' }],
    skills: [
      { name: 'Rust', group: 'Programming' },
      { name: 'C', group: 'Programming' },
      { name: 'GNC', group: 'Control' },
    ],
    languages: [{ name: 'Portuguese' }, { name: 'English' }],
    research_interests: [{ name: 'B', group: 'A' }, { name: 'A', group: 'A' }],
    projects: [{ name: 'Old', start: '2011' }, { name: 'New', start: '2023' }],
    teaching: {
      supervised_students: [{ name: 'Zoe', start: '2019' }, { name: 'Ana', start: '2022' }],
      jury: [{ name: 'Bea', start: '2020' }, { name: 'Carl', start: '2020' }],
    },
  });

  test('dated sections come out newest first', () => {
    const { cv } = sortExport(makeCv(), {}, {});
    expect(cv.experience.map((e) => e.position)).toEqual(['Senior', 'Junior', 'Intern']);
    expect(cv.education.map((e) => e.degree)).toEqual(['PhD', 'BSc']);
    expect(cv.awards.map((e) => e.title)).toEqual(['A', 'B']);
    expect(cv.projects.map((e) => e.name)).toEqual(['New', 'Old']);
    expect(cv.teaching.supervised_students.map((e) => e.name)).toEqual(['Ana', 'Zoe']);
  });

  test('undated entries sort last rather than first', () => {
    const { cv } = sortExport(makeCv(), {}, {});
    expect(cv.experience[cv.experience.length - 1].position).toBe('Intern');
  });

  test('same-date entries fall back to a name tiebreak', () => {
    const { cv } = sortExport(makeCv(), {}, {});
    expect(cv.teaching.jury.map((e) => e.name)).toEqual(['Bea', 'Carl']);
  });

  test('undated sections sort by group then name', () => {
    const { cv } = sortExport(makeCv(), {}, {});
    expect(cv.skills.map((e) => e.name)).toEqual(['GNC', 'C', 'Rust']);
    expect(cv.languages.map((e) => e.name)).toEqual(['English', 'Portuguese']);
    expect(cv.research_interests.map((e) => e.name)).toEqual(['A', 'B']);
  });

  test('dictionary outputs are key-sorted', () => {
    const { personalPages, pubOverrides } = sortExport(
      makeCv(),
      { music: {}, cycling: {} },
      { zzz2024: {}, aaa2020: {} },
    );
    expect(Object.keys(personalPages)).toEqual(['cycling', 'music']);
    expect(Object.keys(pubOverrides)).toEqual(['aaa2020', 'zzz2024']);
  });

  test('is idempotent — sorting twice changes nothing', () => {
    const once = sortExport(makeCv(), {}, {});
    const twice = sortExport(once.cv, once.personalPages, once.pubOverrides);
    expect(twice.cv).toEqual(once.cv);
  });
});

describe('getWebsiteName', () => {
  test('returns the configured setting', () => {
    logseq.settings.websiteName = 'example.org';
    expect(getWebsiteName([])).toBe('example.org');
  });

  test('falls back to the schema default when unset', () => {
    logseq.settings.websiteName = undefined;
    expect(getWebsiteName([])).toBe(DEFAULT_WEBSITE_NAME);
  });

  test('warns when unset rather than defaulting silently', () => {
    logseq.settings.websiteName = undefined;
    const warnings = [];
    getWebsiteName(warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].rule).toBe('settings');
    expect(warnings[0].message).toMatch(/websiteName is not set/);
  });

  test('does not warn when the setting is present', () => {
    logseq.settings.websiteName = 'example.org';
    const warnings = [];
    getWebsiteName(warnings);
    expect(warnings).toHaveLength(0);
  });
});

describe('entryProps', () => {
  test('reads the nested shape', () => {
    expect(entryProps({ properties: { type: 'student' } })).toEqual({ type: 'student' });
  });

  test('reads the flattened shape runExport builds', () => {
    const flat = { _blockContent: '- Ana', type: 'student' };
    expect(entryProps(flat).type).toBe('student');
  });

  test('tolerates a missing block', () => {
    expect(entryProps(null)).toEqual({});
    expect(entryProps(undefined)).toEqual({});
  });
});

// Synthetic names per the roadmap's standing decision. Provenance: the
// two-degrees-one-person case is Hugo Pereira in seed.md P1.
describe('stripDisambiguationSuffix', () => {
  test.each([
    ['Rita Marques (PhD)', 'Rita Marques'],
    ['Rita Marques (M.Sc.)', 'Rita Marques'],
    ['Rita Marques (MSc)', 'Rita Marques'],
    ['Rita Marques (Ph.D.)', 'Rita Marques'],
    ['Rita Marques (BSc)', 'Rita Marques'],
    ['Rita Marques (Postdoc)', 'Rita Marques'],
    ['Rita Marques (phd)', 'Rita Marques'],
  ])('strips %s', (input, expected) => {
    expect(stripDisambiguationSuffix(input)).toBe(expected);
  });

  test('leaves names without a suffix alone', () => {
    expect(stripDisambiguationSuffix('Rita Marques')).toBe('Rita Marques');
  });

  test('does not strip a meaningful parenthetical', () => {
    // Only degree markers are disambiguators; anything else is part of the name.
    expect(stripDisambiguationSuffix('Universidade do Exemplo (UDEX)'))
      .toBe('Universidade do Exemplo (UDEX)');
    expect(stripDisambiguationSuffix('Helena Duarte (UDEX)'))
      .toBe('Helena Duarte (UDEX)');
  });

  test('only strips at the end', () => {
    expect(stripDisambiguationSuffix('(PhD) Rita')).toBe('(PhD) Rita');
  });

  test('passes non-strings through', () => {
    expect(stripDisambiguationSuffix(null)).toBe(null);
    expect(stripDisambiguationSuffix(42)).toBe(42);
  });
});
