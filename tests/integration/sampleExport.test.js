// The sample export that the cross-repo CI job (#10) feeds to the site's
// transform.
//
// These assert the properties the job depends on. If the sample stops being
// deterministic, stops covering a regression, or starts carrying private data,
// the job silently stops proving what it claims to.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const { buildSampleExport, FIXED_NOW } = require('../../scripts/build-sample-export.js');
const { ALL_LINK_KEYS } = require('../__fixtures__/syntheticGraph.js');

describe('the CI sample export', () => {
  let outDir;
  let files;

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alfolio-sample-'));
    ({ files } = await buildSampleExport(outDir));
    vi.restoreAllMocks();
  });

  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  test('writes the export to disk', () => {
    expect(fs.readdirSync(outDir).sort())
      .toEqual(['cv.yml', 'manifest.json', 'personal.yml', 'profile.yml', 'publication_overrides.yml']);
  });

  test('is byte-identical across runs, manifest included', async () => {
    // The assertion the job makes. It only holds because the generator pins
    // `now`: manifest.json carries exported_at, so an unpinned clock would fail
    // this for a reason that is not a determinism break.
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'alfolio-sample-'));
    try {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { files: again } = await buildSampleExport(second);
      vi.restoreAllMocks();
      expect(again).toEqual(files);
      expect(JSON.parse(again['manifest.json']).exported_at).toBe(FIXED_NOW.toISOString());
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }
  });

  test('lints clean, so a real warning would stand out', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alfolio-sample-'));
    try {
      const { warnings } = await buildSampleExport(dir);
      vi.restoreAllMocks();
      expect(warnings.map((w) => `${w.rule}: ${w.message}`)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('covers what the job is meant to catch', () => {
    test('the profile carries every link key — the unmapped-key regression', () => {
      // The site raises TransformError on any profile key it has no mapping
      // for, so this is what turns "add the mapping first" into a red PR.
      const profile = yaml.load(files['profile.yml']);
      for (const key of ALL_LINK_KEYS) {
        expect(profile).toHaveProperty(key);
      }
    });

    test('both null spellings appear — the D28 regression', () => {
      // Emitted inside a list item...
      expect(files['cv.yml']).toContain('description: null');
      // ...and dropped inside a mapping: github has no url, so the key is absent.
      const profile = yaml.load(files['profile.yml']);
      expect(profile.github).toBeDefined();
      expect(profile.github.url ?? null).toBeNull();
      expect(profile.linkedin.url).toBeTruthy();
    });

    test('a personal page keeps non-alphabetical authored section order — the D55 regression', () => {
      const personal = yaml.load(files['personal.yml']);
      // Sections are editorial order: tools before projects, instruments before bands.
      expect(Object.keys(personal.diy.sections)).toEqual(['tools', 'projects']);
      expect(Object.keys(personal.music.sections)).toEqual(['instruments', 'bands']);
    });

    test('page keys are sorted, which is the other half of that distinction', () => {
      const personal = yaml.load(files['personal.yml']);
      expect(Object.keys(personal)).toEqual([...Object.keys(personal)].sort());
    });

    test('every CV section has entries', () => {
      const cv = yaml.load(files['cv.yml']);
      for (const section of ['experience', 'education', 'awards', 'skills', 'languages', 'research_interests', 'projects']) {
        expect(cv[section].length).toBeGreaterThan(0);
      }
      expect(cv.teaching.supervised_students.length).toBeGreaterThan(0);
    });

    test('projects carry the url that links record to write-up', () => {
      const cv = yaml.load(files['cv.yml']);
      expect(cv.projects.every((p) => typeof p.url === 'string')).toBe(true);
    });
  });

  test('contains no real personal data', () => {
    // Synthetic by standing decision: the real capture is private and never
    // committed, so the sample can never be derived from it.
    const everything = Object.values(files).join('\n');
    for (const name of ['Pedro', 'Louren', 'plourenco.eu/Blog', 'Hugo Pereira', 'Gil Serrano']) {
      expect(everything).not.toContain(name);
    }
  });
});
