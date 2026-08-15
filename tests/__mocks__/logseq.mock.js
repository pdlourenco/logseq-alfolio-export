// Installed as a global before every test suite via setupFiles.
// Sets up global.logseq with a default mock, refreshed before each test.

function createDefaultMock() {
  const storage = {
    setItem: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn().mockResolvedValue(null),
  };
  return {
    Editor: {
      getAllPages: vi.fn().mockResolvedValue([]),
      getPageBlocksTree: vi.fn().mockResolvedValue([]),
    },
    DB: {
      datascriptQuery: vi.fn().mockResolvedValue([]),
    },
    Assets: {
      makeSandboxStorage: vi.fn().mockReturnValue(storage),
    },
    UI: {
      showMsg: vi.fn(),
    },
    App: {
      registerUIItem: vi.fn(),
      registerCommandPalette: vi.fn(),
      onGraphAfterIndexed: vi.fn(),
      onCurrentGraphChanged: vi.fn(),
    },
    settings: {
      websiteName: 'plourenco.eu',
      autoExportOnLoad: false,
    },
    useSettingsSchema: vi.fn(),
    ready: vi.fn().mockResolvedValue(undefined),
    provideModel: vi.fn(),
  };
}

// index.js reads its version from package.json at runtime (there is no build
// step, so it cannot be inlined). Serve the real file so assertions about
// plugin_version stay true when the version is bumped.
const fs = require('node:fs');
const path = require('node:path');

function createFetchMock() {
  return vi.fn(async (url) => {
    if (String(url).endsWith('package.json')) {
      const text = fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(text) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

// Set immediately so index.js can be require()'d safely at module level in test files
global.logseq = createDefaultMock();
global.fetch = createFetchMock();

// Reset to fresh mock before each test for full isolation
beforeEach(() => {
  global.logseq = createDefaultMock();
  global.fetch = createFetchMock();
});
