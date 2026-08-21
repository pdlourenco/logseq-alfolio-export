// Permutation invariance: the order Logseq hands us pages and blocks must not
// affect a single byte of the export.
//
// This is the property that makes the committed _incoming/ diff meaningful, and
// it is a hard prerequisite for PR 2.5's content hashes — hashes over unstably
// ordered output would change on every re-index, and a changed hash reads as
// changed content.

const fc = require('fast-check');
const { runExport } = require('../../index.js');

if (process.env.CI) fc.configureGlobal({ seed: 42 });

const SITE = 'plourenco.eu';
const FIXED_NOW = new Date('2026-03-01T12:00:00.000Z');

// The graph lives in a committed fixture because the cross-repo CI sample (#10)
// drives the same one — a determinism guarantee proven against a different
// graph than the one shipped to the consumer would prove less than it looks.
const { buildSyntheticGraph } = require('../__fixtures__/syntheticGraph.js');

const buildGraph = () => buildSyntheticGraph({ site: SITE });

/** Reorder an array by a permutation of its indices. */
const permute = (arr, order) => order.map((i) => arr[i]);

/** An arbitrary permutation of [0..n). */
const permutationOf = (n) =>
  fc.shuffledSubarray([...Array(n).keys()], { minLength: n, maxLength: n });

async function exportWith(pages, blocksByPage) {
  logseq.Editor.getAllPages.mockResolvedValue(pages);
  logseq.Editor.getPageBlocksTree.mockImplementation((name) =>
    Promise.resolve(blocksByPage[name] || []));
  logseq.DB.datascriptQuery.mockResolvedValue([]);
  logseq.Assets.makeSandboxStorage.mockReturnValue({
    setItem: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn(),
  });
  const { files } = await runExport({ now: FIXED_NOW });
  return files;
}

describe('permutation invariance', () => {
  let baseline;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  test('shuffling page order leaves every file byte-identical', async () => {
    const graph = buildGraph();
    baseline = await exportWith(graph.pages, graph.blocksByPage);

    await fc.assert(
      fc.asyncProperty(permutationOf(graph.pages.length), async (order) => {
        const files = await exportWith(permute(graph.pages, order), graph.blocksByPage);
        expect(files).toEqual(baseline);
      }),
      { numRuns: 25 },
    );
  });

  test('shuffling blocks within CV section pages leaves every file byte-identical', async () => {
    const graph = buildGraph();
    const sections = Object.keys(graph.blocksByPage).filter((k) => k.startsWith('CV/') && k !== 'CV/Profile');
    baseline = await exportWith(graph.pages, graph.blocksByPage);

    await fc.assert(
      fc.asyncProperty(
        fc.tuple(...sections.map((s) => permutationOf(graph.blocksByPage[s].length))),
        async (orders) => {
          const shuffled = { ...graph.blocksByPage };
          sections.forEach((section, i) => {
            shuffled[section] = permute(graph.blocksByPage[section], orders[i]);
          });
          const files = await exportWith(graph.pages, shuffled);
          expect(files).toEqual(baseline);
        },
      ),
      { numRuns: 25 },
    );
  });

  test('re-running on identical input produces identical bytes', async () => {
    const graph = buildGraph();
    const first = await exportWith(graph.pages, graph.blocksByPage);
    const second = await exportWith(graph.pages, graph.blocksByPage);
    expect(second).toEqual(first);
  });

  test('the graph actually exercises every ordered section', async () => {
    // Guards the tests above: permutation invariance over empty sections would
    // pass trivially and prove nothing.
    const graph = buildGraph();
    const files = await exportWith(graph.pages, graph.blocksByPage);
    const cv = require('js-yaml').load(files['cv.yml']);

    for (const section of ['experience', 'education', 'awards', 'skills', 'languages', 'research_interests', 'projects']) {
      expect(cv[section].length).toBeGreaterThan(1);
    }
    expect(cv.teaching.supervised_students.length).toBeGreaterThan(1);
  });
});
