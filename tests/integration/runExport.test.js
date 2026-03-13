const { runExport } = require('../../index.js');
const { PAGES_FIXTURE } = require('../__fixtures__/pages.fixture.js');
const {
  EXPERIENCE_BLOCKS,
  EDUCATION_BLOCKS,
  AWARDS_BLOCKS,
  SKILLS_BLOCKS,
  LANGUAGES_BLOCKS,
  RESEARCH_INTERESTS_BLOCKS,
  PROFILE_BLOCKS,
} = require('../__fixtures__/blocks.fixture.js');

// Map page name → blocks for the mock dispatcher
const PAGE_BLOCKS_MAP = {
  'CV/Experience': EXPERIENCE_BLOCKS,
  'CV/Education': EDUCATION_BLOCKS,
  'CV/Awards': AWARDS_BLOCKS,
  'CV/Skills': SKILLS_BLOCKS,
  'CV/Languages': LANGUAGES_BLOCKS,
  'CV/Research Interests': RESEARCH_INTERESTS_BLOCKS,
  'CV/Profile': PROFILE_BLOCKS,
  'plourenco.eu/Publication Overrides': [],
  'plourenco.eu/Blog Ideas': [],
};

describe('runExport', () => {
  let storage;

  beforeEach(() => {
    // Silence console output during runExport
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Pages: return fixture pages
    logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);

    // Blocks: dispatch by page name
    logseq.Editor.getPageBlocksTree.mockImplementation((pageName) => {
      return Promise.resolve(PAGE_BLOCKS_MAP[pageName] || []);
    });

    // DB: return empty (no website pages via datalog)
    logseq.DB.datascriptQuery.mockResolvedValue([]);

    // Capture storage mock
    storage = {
      setItem: vi.fn().mockResolvedValue(undefined),
      getItem: vi.fn().mockResolvedValue(null),
    };
    logseq.Assets.makeSandboxStorage.mockReturnValue(storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('completes without throwing', async () => {
    await expect(runExport()).resolves.not.toThrow();
  });

  test('calls storage.setItem for cv.yml', async () => {
    await runExport();
    const keys = storage.setItem.mock.calls.map((c) => c[0]);
    expect(keys.some((k) => k.endsWith('cv.yml'))).toBe(true);
  });

  test('calls storage.setItem for profile.yml', async () => {
    await runExport();
    const keys = storage.setItem.mock.calls.map((c) => c[0]);
    expect(keys.some((k) => k.endsWith('profile.yml'))).toBe(true);
  });

  test('calls storage.setItem for manifest.json', async () => {
    await runExport();
    const keys = storage.setItem.mock.calls.map((c) => c[0]);
    expect(keys.some((k) => k.endsWith('manifest.json'))).toBe(true);
  });

  test('manifest.json is valid JSON with expected structure', async () => {
    await runExport();
    const manifestCall = storage.setItem.mock.calls.find((c) => c[0].endsWith('manifest.json'));
    expect(manifestCall).toBeDefined();
    const manifest = JSON.parse(manifestCall[1]);
    expect(manifest.plugin_version).toBe('0.1.0');
    expect(manifest.website).toBe('plourenco.eu');
    expect(manifest.counts).toBeDefined();
    expect(typeof manifest.counts.experience).toBe('number');
  });

  test('cv.yml contains experience data', async () => {
    await runExport();
    const cvCall = storage.setItem.mock.calls.find((c) => c[0].endsWith('cv.yml'));
    expect(cvCall).toBeDefined();
    const yaml = cvCall[1];
    expect(yaml).toContain('experience');
    expect(yaml).toContain('Researcher');
  });

  test('profile.yml contains profile data', async () => {
    await runExport();
    const profileCall = storage.setItem.mock.calls.find((c) => c[0].endsWith('profile.yml'));
    expect(profileCall).toBeDefined();
    const yaml = profileCall[1];
    expect(yaml).toContain('John Doe');
  });

  test('calls UI.showMsg with success on completion', async () => {
    await runExport();
    expect(logseq.UI.showMsg).toHaveBeenCalledWith(
      expect.stringContaining('complete'),
      'success'
    );
  });

  test('calls UI.showMsg with error when getAllPages fails', async () => {
    logseq.Editor.getAllPages.mockRejectedValue(new Error('Network error'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await runExport();

    expect(logseq.UI.showMsg).toHaveBeenCalledWith(
      expect.stringContaining('failed'),
      'error'
    );
  });

  test('manifest counts match transformed data', async () => {
    await runExport();
    const manifestCall = storage.setItem.mock.calls.find((c) => c[0].endsWith('manifest.json'));
    const manifest = JSON.parse(manifestCall[1]);
    // 1 experience entry (position-filtered: only EXPERIENCE_BLOCKS[0])
    expect(manifest.counts.experience).toBe(1);
    // 2 education entries
    expect(manifest.counts.education).toBe(2);
  });
});
