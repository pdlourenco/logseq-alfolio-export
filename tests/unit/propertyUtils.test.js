const {
  stripBrackets,
  extractRefs,
  convertDate,
  parseCommaSeparatedRefs,
  parsePeopleRefs,
  parseMarkdownLink,
  extractBlockTitle,
  cleanProp,
  rawProp,
} = require('../../index.js');

describe('stripBrackets', () => {
  test('removes [[ and ]] from a simple ref', () => {
    expect(stripBrackets('[[Page Name]]')).toBe('Page Name');
  });

  test('removes multiple refs from a string', () => {
    expect(stripBrackets('text [[A]] and [[B]]')).toBe('text A and B');
  });

  test('non-string is returned as-is', () => {
    expect(stripBrackets(42)).toBe(42);
    expect(stripBrackets(null)).toBe(null);
    expect(stripBrackets(undefined)).toBe(undefined);
  });

  test('string without refs is unchanged', () => {
    expect(stripBrackets('plain text')).toBe('plain text');
  });
});

describe('extractRefs', () => {
  test('extracts single ref', () => {
    expect(extractRefs('[[Page Name]]')).toEqual(['Page Name']);
  });

  test('extracts multiple refs', () => {
    expect(extractRefs('[[A]], [[B]]')).toEqual(['A', 'B']);
  });

  test('returns empty array when no refs', () => {
    expect(extractRefs('no refs here')).toEqual([]);
  });

  test('non-string returns empty array', () => {
    expect(extractRefs(null)).toEqual([]);
    expect(extractRefs(42)).toEqual([]);
  });
});

describe('convertDate', () => {
  test('converts Logseq month date to ISO format', () => {
    expect(convertDate('[[2022/07]]')).toBe('2022-07');
  });

  test('converts Logseq full date to ISO format', () => {
    expect(convertDate('[[2022/07/15]]')).toBe('2022-07-15');
  });

  test('plain string with slashes converts slashes to dashes', () => {
    expect(convertDate('2022/07')).toBe('2022-07');
  });

  test('non-string is returned as-is', () => {
    expect(convertDate(null)).toBe(null);
    expect(convertDate(42)).toBe(42);
  });
});

describe('parseCommaSeparatedRefs', () => {
  test('splits comma-separated string', () => {
    expect(parseCommaSeparatedRefs('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  test('filters empty strings', () => {
    expect(parseCommaSeparatedRefs('a,,b')).toEqual(['a', 'b']);
  });

  test('non-string returns empty array', () => {
    expect(parseCommaSeparatedRefs(null)).toEqual([]);
    expect(parseCommaSeparatedRefs(['a', 'b'])).toEqual([]);
  });
});

describe('parsePeopleRefs', () => {
  test('parses single ref without title', () => {
    expect(parsePeopleRefs('[[Paulo Oliveira]]')).toEqual([
      { title: '', name: 'Paulo Oliveira' },
    ]);
  });

  test('parses ref with Prof. title', () => {
    expect(parsePeopleRefs('Prof. [[Paulo Oliveira]]')).toEqual([
      { title: 'Prof.', name: 'Paulo Oliveira' },
    ]);
  });

  test('parses ref with Dr. title', () => {
    expect(parsePeopleRefs('Dr. [[Jane Doe]]')).toEqual([
      { title: 'Dr.', name: 'Jane Doe' },
    ]);
  });

  test('parses ref with Eng. title', () => {
    expect(parsePeopleRefs('Eng. [[Bob Builder]]')).toEqual([
      { title: 'Eng.', name: 'Bob Builder' },
    ]);
  });

  test('parses multiple people', () => {
    const result = parsePeopleRefs('Prof. [[Paulo Oliveira]], [[John Smith]]');
    expect(result).toEqual([
      { title: 'Prof.', name: 'Paulo Oliveira' },
      { title: '', name: 'John Smith' },
    ]);
  });

  test('plain text returns stripped name', () => {
    expect(parsePeopleRefs('plain text')).toEqual([
      { title: '', name: 'plain text' },
    ]);
  });

  test('non-string returns empty array', () => {
    expect(parsePeopleRefs(null)).toEqual([]);
    expect(parsePeopleRefs(42)).toEqual([]);
  });
});

describe('parseMarkdownLink', () => {
  test('parses [label](url) format', () => {
    expect(parseMarkdownLink('[johndoe](https://github.com/johndoe)')).toEqual({
      label: 'johndoe',
      url: 'https://github.com/johndoe',
    });
  });

  test('parses empty label', () => {
    expect(parseMarkdownLink('[](https://example.com)')).toEqual({
      label: '',
      url: 'https://example.com',
    });
  });

  test('returns null for plain string', () => {
    expect(parseMarkdownLink('not a link')).toBeNull();
  });

  test('returns null for partial markdown', () => {
    expect(parseMarkdownLink('[label]')).toBeNull();
    expect(parseMarkdownLink('(url)')).toBeNull();
  });

  test('non-string returns null', () => {
    expect(parseMarkdownLink(null)).toBeNull();
    expect(parseMarkdownLink(42)).toBeNull();
  });
});

describe('extractBlockTitle', () => {
  test('returns first non-property line', () => {
    expect(extractBlockTitle('My Title\ntype:: experience')).toBe('My Title');
  });

  test('skips property lines at start', () => {
    expect(extractBlockTitle('type:: experience\nMy Title')).toBe('My Title');
  });

  test('strips [[ ]] from title', () => {
    expect(extractBlockTitle('[[Page Name]]\ntype:: ref')).toBe('Page Name');
  });

  test('strips leading dash from title', () => {
    expect(extractBlockTitle('- My Title\ntype:: x')).toBe('My Title');
  });

  test('returns empty string for empty content', () => {
    expect(extractBlockTitle('')).toBe('');
    expect(extractBlockTitle(null)).toBe('');
    expect(extractBlockTitle(undefined)).toBe('');
  });

  test('skips empty lines', () => {
    expect(extractBlockTitle('\n\nMy Title')).toBe('My Title');
  });

  test('returns empty string when only property lines', () => {
    expect(extractBlockTitle('type:: experience\norg:: [[X]]')).toBe('');
  });
});

describe('cleanProp', () => {
  test('returns null for undefined key', () => {
    expect(cleanProp({}, 'missing')).toBeNull();
  });

  test('returns null for null value', () => {
    expect(cleanProp({ key: null }, 'key')).toBeNull();
  });

  test('strips brackets from string value', () => {
    expect(cleanProp({ org: '[[University of Porto]]' }, 'org')).toBe('University of Porto');
  });

  test('handles array value by joining', () => {
    expect(cleanProp({ org: ['University of Porto'] }, 'org')).toBe('University of Porto');
  });

  test('handles array with multiple items', () => {
    expect(cleanProp({ alias: ['A', 'B'] }, 'alias')).toBe('A, B');
  });

  test('returns null for empty result', () => {
    expect(cleanProp({ key: '' }, 'key')).toBeNull();
  });

  test('plain string value returned as-is', () => {
    expect(cleanProp({ pos: 'Researcher' }, 'pos')).toBe('Researcher');
  });
});

describe('rawProp', () => {
  test('returns null for undefined key', () => {
    expect(rawProp({}, 'missing')).toBeNull();
  });

  test('returns null for null value', () => {
    expect(rawProp({ key: null }, 'key')).toBeNull();
  });

  test('reconstructs [[ref]] syntax from array', () => {
    expect(rawProp({ org: ['University of Porto'] }, 'org')).toBe('[[University of Porto]]');
  });

  test('reconstructs multiple refs from array', () => {
    expect(rawProp({ orgs: ['A', 'B'] }, 'orgs')).toBe('[[A]], [[B]]');
  });

  test('returns string value as-is', () => {
    expect(rawProp({ start: '[[2022/07]]' }, 'start')).toBe('[[2022/07]]');
  });
});
