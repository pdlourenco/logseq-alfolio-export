const { ResolutionCache } = require('../../index.js');
const { PAGES_FIXTURE } = require('../__fixtures__/pages.fixture.js');

describe('ResolutionCache', () => {
  let cache;

  beforeEach(() => {
    cache = new ResolutionCache();
  });

  describe('build()', () => {
    test('populates pageCache with lowercase keys', async () => {
      logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
      await cache.build();

      expect(cache.pageCache['university of porto']).toBeDefined();
      expect(cache.pageCache['university of porto'].originalName).toBe('University of Porto');
    });

    test('builds iconMap from icon property', async () => {
      logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
      await cache.build();

      expect(cache.iconMap['university of porto']).toBe('up');
      expect(cache.iconMap['university of minho']).toBe('uminho');
    });

    test('builds abbreviationMap from abbreviation property', async () => {
      logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
      await cache.build();

      expect(cache.abbreviationMap['university of porto']).toBe('UP');
      expect(cache.abbreviationMap['university of minho']).toBe('UMinho');
    });

    test('builds aliasMap from alias array', async () => {
      logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
      await cache.build();

      expect(cache.aliasMap['uporto']).toBe('University of Porto');
      expect(cache.aliasMap['up']).toBe('University of Porto');
    });

    test('builds affiliationMap for person pages', async () => {
      logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
      await cache.build();

      const info = cache.affiliationMap['paulo oliveira'];
      expect(info).toBeDefined();
      expect(info.affiliation).toBe('University of Porto');
    });

    test('second pass resolves affiliation abbreviation', async () => {
      logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
      await cache.build();

      const info = cache.affiliationMap['paulo oliveira'];
      expect(info.abbreviation).toBe('UP');
    });

    test('handles null getAllPages response', async () => {
      logseq.Editor.getAllPages.mockResolvedValue(null);
      await cache.build();

      expect(Object.keys(cache.pageCache)).toHaveLength(0);
    });

    test('handles empty getAllPages response', async () => {
      logseq.Editor.getAllPages.mockResolvedValue([]);
      await cache.build();

      expect(Object.keys(cache.pageCache)).toHaveLength(0);
    });
  });

  describe('resolvePageName()', () => {
    beforeEach(async () => {
      logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
      await cache.build();
    });

    test('resolves direct match (case-insensitive)', () => {
      expect(cache.resolvePageName('university of porto')).toBe('University of Porto');
      expect(cache.resolvePageName('University of Porto')).toBe('University of Porto');
      expect(cache.resolvePageName('UNIVERSITY OF PORTO')).toBe('University of Porto');
    });

    test('resolves alias match', () => {
      expect(cache.resolvePageName('UPorto')).toBe('University of Porto');
    });

    test('returns name as-is when no match', () => {
      expect(cache.resolvePageName('Unknown Org')).toBe('Unknown Org');
    });

    test('handles null/undefined', () => {
      expect(cache.resolvePageName(null)).toBeNull();
      expect(cache.resolvePageName(undefined)).toBeUndefined();
    });
  });

  describe('resolveValue()', () => {
    beforeEach(async () => {
      logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
      await cache.build();
    });

    test('expands [[ref]] to canonical name', () => {
      expect(cache.resolveValue('[[University of Porto]]')).toBe('University of Porto');
    });

    test('resolves alias in [[ref]]', () => {
      expect(cache.resolveValue('[[UPorto]]')).toBe('University of Porto');
    });

    test('handles multiple refs', () => {
      const result = cache.resolveValue('[[University of Porto]], [[University of Minho]]');
      expect(result).toBe('University of Porto, University of Minho');
    });

    test('non-string is returned as-is', () => {
      expect(cache.resolveValue(42)).toBe(42);
    });
  });

  describe('getIcon()', () => {
    beforeEach(async () => {
      logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
      await cache.build();
    });

    test('returns icon for known org', () => {
      expect(cache.getIcon('University of Porto')).toBe('up');
    });

    test('returns null for unknown org', () => {
      expect(cache.getIcon('Unknown Org')).toBeNull();
    });

    test('returns null for null/undefined', () => {
      expect(cache.getIcon(null)).toBeNull();
      expect(cache.getIcon(undefined)).toBeNull();
    });
  });

  describe('getAbbreviation()', () => {
    beforeEach(async () => {
      logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
      await cache.build();
    });

    test('returns abbreviation for known institution', () => {
      expect(cache.getAbbreviation('University of Porto')).toBe('UP');
    });

    test('returns null for unknown institution', () => {
      expect(cache.getAbbreviation('Unknown')).toBeNull();
    });
  });

  describe('resolveSupervisor()', () => {
    beforeEach(async () => {
      logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
      await cache.build();
    });

    test('supervisor at same university — no affiliation label', () => {
      const result = cache.resolveSupervisor(
        { title: 'Prof.', name: 'Paulo Oliveira' },
        ['University of Porto']
      );
      expect(result.name).toBe('Prof. Paulo Oliveira');
      expect(result.affiliation).toBeNull();
    });

    test('supervisor at different university — abbreviation label', () => {
      const result = cache.resolveSupervisor(
        { title: 'Prof.', name: 'John Smith' },
        ['University of Porto']
      );
      expect(result.name).toBe('Prof. John Smith');
      expect(result.affiliation).toBe('UMinho');
    });

    test('supervisor with no affiliation info', () => {
      const result = cache.resolveSupervisor(
        { title: '', name: 'Unknown Person' },
        ['University of Porto']
      );
      expect(result.name).toBe('Unknown Person');
      expect(result.affiliation).toBeNull();
    });
  });
});
