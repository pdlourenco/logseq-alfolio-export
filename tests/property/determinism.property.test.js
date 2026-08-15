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

const cvEntry = (props, content) => ({ content, properties: props });

/** A synthetic graph with enough of each section to have an order at all. */
function buildGraph() {
  const cvBlocks = {
    'CV/Experience': [
      cvEntry({ type: '[[experience]]', position: 'Engineer', organization: '[[Orbital Systems]]', start: '[[2019/03]]' }, '- Engineer'),
      cvEntry({ type: '[[experience]]', position: 'Researcher', organization: '[[UDEX]]', start: '[[2022/01]]' }, '- Researcher'),
      cvEntry({ type: '[[experience]]', position: 'Intern', organization: '[[Orbital Systems]]', start: '[[2016/06]]' }, '- Intern'),
    ],
    'CV/Education': [
      cvEntry({ type: '[[education]]', degree: 'PhD', start: '[[2018/09]]' }, '- PhD'),
      cvEntry({ type: '[[education]]', degree: 'MSc', start: '[[2015/09]]' }, '- MSc'),
    ],
    'CV/Awards': [
      cvEntry({ type: '[[award]]', date: '[[2021/05]]', awarder: '[[UDEX]]' }, '- Best Paper'),
      cvEntry({ type: '[[award]]', date: '[[2019/11]]', awarder: '[[Orbital Systems]]' }, '- Merit Grant'),
    ],
    'CV/Skills': [
      cvEntry({ type: '[[skill]]', group: 'Programming', level: '4' }, '- Rust'),
      cvEntry({ type: '[[skill]]', group: 'Programming', level: '5' }, '- C'),
      cvEntry({ type: '[[skill]]', group: 'Control', level: '5' }, '- GNC'),
    ],
    'CV/Languages': [
      cvEntry({ type: '[[language]]', speaking: '5' }, '- Portuguese'),
      cvEntry({ type: '[[language]]', speaking: '4' }, '- English'),
    ],
    'CV/Research Interests': [
      cvEntry({ type: '[[research-interest]]', group: 'Robotics', level: '5' }, '- Estimation'),
      cvEntry({ type: '[[research-interest]]', group: 'Robotics', level: '4' }, '- Control'),
    ],
    'CV/Profile': [
      cvEntry({ 'name-long': 'Test Person', 'email-personal': 'a@b.c' }, '- Profile'),
    ],
    [`${SITE}/Publication Overrides`]: [],
    [`${SITE}/Blog Ideas`]: [],
  };

  const standalone = [
    { name: 'Ana Silva', type: 'student', start: '[[2021/09]]' },
    { name: 'Bruno Costa', type: 'student', start: '[[2019/09]]' },
    { name: 'Nav Filter', type: 'project', start: '[[2022/01]]' },
    { name: 'Sim Pipeline', type: 'project', start: '[[2020/04]]' },
  ].map(({ name, type, start }) => ({
    page: { name, originalName: name, properties: { website: `[[${SITE}]]` } },
    blocks: [{
      content: `- ${name}`,
      properties: {
        website: `[[${SITE}]]`,
        type: `[[${type}]]`,
        start,
        ...(type === 'student'
          ? { university: '[[UDEX]]', supervisor: 'Prof. [[Miguel Antunes]]', 'thesis-type': 'MSc' }
          : {}),
      },
    }],
  }));

  const personal = ['Personal/Music', 'Personal/Reading'].map((name) => ({
    page: { name, originalName: name, properties: { website: `[[${SITE}]]` } },
    blocks: [{ content: `- ${name}`, properties: { website: `[[${SITE}]]` }, children: [] }],
  }));

  const supportPages = [
    { name: 'UDEX', originalName: 'UDEX', properties: { icon: 'ist', abbreviation: 'UDEX' } },
    { name: 'Orbital Systems', originalName: 'Orbital Systems', properties: { icon: 'gmv' } },
    { name: 'Miguel Antunes', originalName: 'Miguel Antunes', properties: { type: '[[person]]', affiliation: '[[UDEX]]' } },
  ];

  return {
    pages: [...supportPages, ...standalone.map((s) => s.page), ...personal.map((p) => p.page)],
    blocksByPage: {
      ...cvBlocks,
      ...Object.fromEntries([...standalone, ...personal].map((e) => [e.page.originalName, e.blocks])),
    },
  };
}

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
