// Integration tests for the PR 2 behaviours: dry run, the configurable site
// name, the warning summary, a pinnable timestamp, and the flattened-block fix
// that made students and projects reachable from runExport at all.

const yaml = require('js-yaml');
const { runExport } = require('../../index.js');

const FIXED_NOW = new Date('2026-03-01T12:00:00.000Z');

/** A student page in the shape runExport's standalone scan walks. */
function studentPage(site, { name = 'Ana Silva', start = '[[2021/09]]' } = {}) {
  return {
    page: { name: `${name}`, originalName: `${name}`, properties: { website: `[[${site}]]` } },
    blocks: [{
      content: `- ${name}\n  type:: [[student]]`,
      properties: {
        website: `[[${site}]]`,
        type: '[[student]]',
        university: '[[UDEX]]',
        supervisor: 'Prof. [[Miguel Antunes]]',
        'thesis-type': 'MSc',
        start,
      },
    }],
  };
}

function projectPage(site, { name = 'Nav Filter', start = '[[2022/01]]' } = {}) {
  return {
    page: { name, originalName: name, properties: { website: `[[${site}]]` } },
    blocks: [{
      content: `- ${name}\n  type:: [[project]]`,
      properties: { website: `[[${site}]]`, type: '[[project]]', start },
    }],
  };
}

/** Wire a graph made of {page, blocks} entries into the logseq mock. */
function installGraph(entries, extraPages = {}) {
  const pages = entries.map((e) => e.page);
  const blocksByPage = {};
  for (const e of entries) blocksByPage[e.page.originalName] = e.blocks;
  Object.assign(blocksByPage, extraPages);

  logseq.Editor.getAllPages.mockResolvedValue(pages);
  logseq.Editor.getPageBlocksTree.mockImplementation((name) =>
    Promise.resolve(blocksByPage[name] || []));
  logseq.DB.datascriptQuery.mockResolvedValue([]);
}

describe('export behaviour', () => {
  let storage;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage = { setItem: vi.fn().mockResolvedValue(undefined), getItem: vi.fn() };
    logseq.Assets.makeSandboxStorage.mockReturnValue(storage);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('students and projects reach the output', () => {
    // Regression: runExport flattens block properties onto the entry, but the
    // transformers read block.properties. Every one of these was silently empty
    // in a real export while the unit tests passed on nested fixtures.
    test('a website-tagged student page produces a supervised student', async () => {
      installGraph([studentPage('plourenco.eu')]);

      const { files } = await runExport({ now: FIXED_NOW });
      const cv = yaml.load(files['cv.yml']);

      expect(cv.teaching.supervised_students).toHaveLength(1);
      expect(cv.teaching.supervised_students[0].name).toBe('Ana Silva');
    });

    test('a website-tagged project page produces a project', async () => {
      installGraph([projectPage('plourenco.eu')]);

      const { files } = await runExport({ now: FIXED_NOW });
      const cv = yaml.load(files['cv.yml']);

      expect(cv.projects).toHaveLength(1);
      expect(cv.projects[0].name).toBe('Nav Filter');
    });

    test('the manifest counts agree with the emitted YAML', async () => {
      installGraph([studentPage('plourenco.eu'), projectPage('plourenco.eu')]);

      const { files } = await runExport({ now: FIXED_NOW });
      const manifest = JSON.parse(files['manifest.json']);
      const cv = yaml.load(files['cv.yml']);

      expect(manifest.counts.supervised_students).toBe(cv.teaching.supervised_students.length);
      expect(manifest.counts.projects).toBe(cv.projects.length);
      expect(manifest.counts.supervised_students).toBe(1);
    });

    test('a degree suffix is stripped from the exported name', async () => {
      installGraph([{
        page: { name: 'Rita Marques', originalName: 'Rita Marques', properties: { website: '[[plourenco.eu]]' } },
        blocks: [{
          content: '- Rita Marques (PhD)\n  type:: [[student]]',
          properties: {
            website: '[[plourenco.eu]]', type: '[[student]]',
            university: '[[UDEX]]', supervisor: 'Prof. [[Miguel Antunes]]', start: '[[2020/09]]',
          },
        }],
      }]);

      const { files } = await runExport({ now: FIXED_NOW });
      const cv = yaml.load(files['cv.yml']);

      expect(cv.teaching.supervised_students[0].name).toBe('Rita Marques');
    });
  });

  describe('the site name comes from the setting', () => {
    test('a non-default websiteName selects pages and namespace pages', async () => {
      logseq.settings.websiteName = 'example.org';
      installGraph([studentPage('example.org')], {
        'example.org/Publication Overrides': [{
          content: '- key2024',
          properties: { type: '[[publication-override]]', selected: 'true' },
        }],
      });

      const { files } = await runExport({ now: FIXED_NOW });

      expect(JSON.parse(files['manifest.json']).website).toBe('example.org');
      expect(yaml.load(files['cv.yml']).teaching.supervised_students).toHaveLength(1);
      // The namespace page was looked up under the configured site name.
      expect(logseq.Editor.getPageBlocksTree).toHaveBeenCalledWith('example.org/Publication Overrides');
      // Blog Ideas is no longer read at all (#8): narrative content is authored
      // in the site repo, so the plugin never touches that page.
      expect(logseq.Editor.getPageBlocksTree).not.toHaveBeenCalledWith('example.org/Blog Ideas');
    });

    test('pages tagged with a different site are not exported', async () => {
      logseq.settings.websiteName = 'example.org';
      installGraph([studentPage('someone-else.net')]);

      const { files } = await runExport({ now: FIXED_NOW });

      expect(yaml.load(files['cv.yml']).teaching.supervised_students).toHaveLength(0);
    });

    test('an unset websiteName warns instead of defaulting silently', async () => {
      logseq.settings.websiteName = undefined;
      installGraph([]);

      const { warnings } = await runExport({ now: FIXED_NOW });

      expect(warnings.some((w) => w.rule === 'settings')).toBe(true);
    });
  });

  describe('dry run', () => {
    test('writes nothing', async () => {
      installGraph([studentPage('plourenco.eu')]);

      await runExport({ dryRun: true, now: FIXED_NOW });

      expect(storage.setItem).not.toHaveBeenCalled();
    });

    test('does not even open the storage sandbox', async () => {
      installGraph([studentPage('plourenco.eu')]);

      await runExport({ dryRun: true, now: FIXED_NOW });

      expect(logseq.Assets.makeSandboxStorage).not.toHaveBeenCalled();
    });

    test('produces the same files a real export would', async () => {
      installGraph([studentPage('plourenco.eu'), projectPage('plourenco.eu')]);
      const dry = await runExport({ dryRun: true, now: FIXED_NOW });

      installGraph([studentPage('plourenco.eu'), projectPage('plourenco.eu')]);
      const wet = await runExport({ now: FIXED_NOW });

      expect(dry.files).toEqual(wet.files);
    });

    test('says it was a dry run in the toast', async () => {
      installGraph([]);
      await runExport({ dryRun: true, now: FIXED_NOW });
      expect(logseq.UI.showMsg).toHaveBeenCalledWith(
        expect.stringContaining('dry run'), 'success',
      );
    });
  });

  describe('warning summary', () => {
    test('the toast reports the warning count and points at the console', async () => {
      // Missing start:: and an unresolvable university trip two rules.
      installGraph([{
        page: { name: 'Bad', originalName: 'Bad', properties: { website: '[[plourenco.eu]]' } },
        blocks: [{
          content: '- Bad Entry',
          properties: { website: '[[plourenco.eu]]', type: '[[student]]', university: '[[Nowhere]]' },
        }],
      }]);

      await runExport({ now: FIXED_NOW });

      expect(logseq.UI.showMsg).toHaveBeenCalledWith(
        expect.stringMatching(/\d+ entries, \d+ files, \d+ warnings? — see console/),
        'success',
      );
    });

    test('a clean graph reports no warnings in the toast', async () => {
      installGraph([]);
      await runExport({ now: FIXED_NOW });
      expect(logseq.UI.showMsg).toHaveBeenCalledWith(
        expect.not.stringContaining('warning'), 'success',
      );
    });

    test('warnings never fail the export', async () => {
      installGraph([{
        page: { name: 'Bad', originalName: 'Bad', properties: { website: '[[plourenco.eu]]' } },
        blocks: [{ content: '- Bad', properties: { website: '[[plourenco.eu]]', type: '[[student]]' } }],
      }]);

      const { files, warnings } = await runExport({ now: FIXED_NOW });

      expect(warnings.length).toBeGreaterThan(0);
      expect(files['cv.yml']).toBeDefined();
      expect(storage.setItem).toHaveBeenCalled();
    });
  });

  describe('timestamp', () => {
    test('exported_at uses the injected time', async () => {
      installGraph([]);
      const { files } = await runExport({ now: FIXED_NOW });
      expect(JSON.parse(files['manifest.json']).exported_at).toBe('2026-03-01T12:00:00.000Z');
    });

    test('defaults to now when not injected', async () => {
      installGraph([]);
      const before = Date.now();
      const { files } = await runExport();
      const at = Date.parse(JSON.parse(files['manifest.json']).exported_at);
      expect(at).toBeGreaterThanOrEqual(before);
    });
  });
});
