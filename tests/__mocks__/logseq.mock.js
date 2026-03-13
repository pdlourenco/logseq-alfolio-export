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

// Set immediately so index.js can be require()'d safely at module level in test files
global.logseq = createDefaultMock();

// Reset to fresh mock before each test for full isolation
beforeEach(() => {
  global.logseq = createDefaultMock();
});
