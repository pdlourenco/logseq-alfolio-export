// manifest.json against intermediate-format contract v1.
//
// The normative schemas live in the site repo (docs/intermediate-schema/), so
// these assert the constraints that schema states — required fields, the
// version gate, the both-directions file list, hash format — against what the
// plugin actually emits. The site's transform refuses an export that fails any
// of them.

const crypto = require('node:crypto');
const { runExport } = require('../../index.js');
const pkg = require('../../package.json');

const FIXED_NOW = new Date('2026-03-01T12:00:00.000Z');

const BLOG_BLOCKS = [{
  content: '- A Post About Filters',
  properties: {
    type: '[[blog-idea]]',
    status: 'published',
    slug: 'a-post-about-filters',
    date: '[[2026/02/14]]',
    categories: 'gnc',
  },
}];

function installGraph({ withBlog = false } = {}) {
  logseq.Editor.getAllPages.mockResolvedValue([]);
  logseq.Editor.getPageBlocksTree.mockImplementation((name) =>
    Promise.resolve(withBlog && name === 'plourenco.eu/Blog Ideas' ? BLOG_BLOCKS : []));
  logseq.DB.datascriptQuery.mockResolvedValue([]);
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

describe('manifest.json — contract v1', () => {
  let storage;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage = { setItem: vi.fn().mockResolvedValue(undefined), getItem: vi.fn() };
    logseq.Assets.makeSandboxStorage.mockReturnValue(storage);
    installGraph();
  });

  afterEach(() => vi.restoreAllMocks());

  const manifestFrom = (files) => JSON.parse(files['manifest.json']);

  describe('required fields', () => {
    test('declares schema_version 1', async () => {
      const { files } = await runExport({ now: FIXED_NOW });
      expect(manifestFrom(files).schema_version).toBe(1);
    });

    test('exported_at matches the timestamp pattern the schema enforces', async () => {
      const { files } = await runExport({ now: FIXED_NOW });
      expect(manifestFrom(files).exported_at)
        .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
    });

    test('files is a non-empty list of unique strings', async () => {
      const { files } = await runExport({ now: FIXED_NOW });
      const listed = manifestFrom(files).files;
      expect(listed.length).toBeGreaterThan(0);
      expect(new Set(listed).size).toBe(listed.length);
      expect(listed.every((f) => typeof f === 'string' && f.length > 0)).toBe(true);
    });
  });

  describe('files describes the export in both directions', () => {
    test('lists every file written, including manifest.json itself', async () => {
      const { files } = await runExport({ now: FIXED_NOW });
      expect(manifestFrom(files).files.sort()).toEqual(Object.keys(files).sort());
    });

    test('matches what was actually written to storage', async () => {
      const { files } = await runExport({ now: FIXED_NOW });
      const written = storage.setItem.mock.calls
        .map(([key]) => key.replace(/^_logseq_export\//, ''))
        .sort();
      expect(manifestFrom(files).files.sort()).toEqual(written);
    });

    test('emits no blog files, even when the graph still has a Blog Ideas page', async () => {
      // Scope reduction (#8): narrative content is authored in the site repo.
      // A graph that still carries the old page must simply be ignored — the
      // page is not read, and nothing about it reaches the export.
      installGraph({ withBlog: true });
      const { files } = await runExport({ now: FIXED_NOW });
      const listed = manifestFrom(files).files;

      expect(listed.some((f) => f.startsWith('blog/'))).toBe(false);
      expect(listed.sort()).toEqual(Object.keys(files).sort());
      expect(listed.sort()).toEqual([
        'cv.yml', 'manifest.json', 'personal.yml', 'profile.yml', 'publication_overrides.yml',
      ]);
    });

    test('every exported path is flat, so no nested storage key is needed', async () => {
      installGraph({ withBlog: true });
      const { files } = await runExport({ now: FIXED_NOW });
      for (const name of Object.keys(files)) {
        expect(name).not.toContain('/');
      }
    });

    test('is sorted, so the manifest is stable across runs', async () => {
      installGraph({ withBlog: true });
      const { files } = await runExport({ now: FIXED_NOW });
      const listed = manifestFrom(files).files;
      expect(listed).toEqual([...listed].sort());
    });
  });

  describe('hashes', () => {
    test('covers exactly the exported files minus the manifest itself', async () => {
      installGraph({ withBlog: true });
      const { files } = await runExport({ now: FIXED_NOW });
      const manifest = manifestFrom(files);

      const expected = manifest.files.filter((f) => f !== 'manifest.json').sort();
      expect(Object.keys(manifest.hashes).sort()).toEqual(expected);
    });

    test('each hash is the sha256 of the file that was written', async () => {
      const { files } = await runExport({ now: FIXED_NOW });
      const manifest = manifestFrom(files);

      for (const [name, hash] of Object.entries(manifest.hashes)) {
        expect(hash).toBe(sha256(files[name]));
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    test('a truncated file no longer matches its hash', async () => {
      const { files } = await runExport({ now: FIXED_NOW });
      const manifest = manifestFrom(files);
      // What the hashes exist to catch: a half-finished copy.
      expect(sha256(files['cv.yml'].slice(0, -5))).not.toBe(manifest.hashes['cv.yml']);
    });

    test('are omitted with a warning where WebCrypto is unavailable', async () => {
      const realCrypto = globalThis.crypto;
      // The plugin sandbox may not be a secure context; the contract makes
      // hashes optional precisely so the export still succeeds there.
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      try {
        const { files, warnings } = await runExport({ now: FIXED_NOW });
        const manifest = manifestFrom(files);
        expect(manifest.hashes).toBeUndefined();
        expect(manifest.schema_version).toBe(1);
        expect(warnings.some((w) => w.rule === 'hashes-unavailable')).toBe(true);
      } finally {
        Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true });
      }
    });
  });

  describe('plugin_version', () => {
    test('comes from package.json rather than a literal', async () => {
      const { files } = await runExport({ now: FIXED_NOW });
      expect(manifestFrom(files).plugin_version).toBe(pkg.version);
    });

    test('is omitted with a warning when package.json cannot be read', async () => {
      // Rather than substituting a guess: a stale hardcoded version is the
      // problem this replaces.
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 });

      const { files, warnings } = await runExport({ now: FIXED_NOW });

      expect(manifestFrom(files).plugin_version).toBeUndefined();
      expect(warnings.some((w) => w.rule === 'plugin-version')).toBe(true);
    });
  });

  describe('counts', () => {
    test('are all non-negative integers, as the schema requires', async () => {
      const { files } = await runExport({ now: FIXED_NOW });
      for (const value of Object.values(manifestFrom(files).counts)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
