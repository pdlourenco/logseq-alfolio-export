// The privacy boundary, as a machine-checked invariant.
//
// `Personal/` is a private wiki. Only pages carrying `website:: [[<site>]]`
// are exported; everything else — recipes, home-office notes, whatever else
// lives there — must never reach an output file. seed.md calls this a privacy
// boundary, and a boundary asserted only by reading the code is not a boundary.
//
// So: generate graphs with an arbitrary mix of tagged and untagged Personal/
// pages, and assert that no untagged page contributes a single byte.

const fc = require('fast-check');
const { runExport, FixtureGraphReader } = require('../../index.js');

if (process.env.CI) fc.configureGlobal({ seed: 42 });

const SITE = 'plourenco.eu';
const FIXED_NOW = new Date('2026-03-01T12:00:00.000Z');

/**
 * A Personal/ page whose every field carries a unique, searchable marker, so
 * any leak into the output is detectable wherever it surfaces.
 */
const personalPage = fc.record({
  id: fc.integer({ min: 0, max: 9999 }),
  tagged: fc.boolean(),
  section: fc.constantFrom('Music', 'Reading', 'Cycling', 'DIY', 'Recipes', 'HomeOffice'),
});

function buildGraph(specs) {
  const pages = [];
  const blocksByPage = {};
  const markers = [];

  specs.forEach((spec, index) => {
    // Unique per page: the index keeps markers distinct when fast-check
    // generates two specs with the same id.
    const marker = `MARKER${index}x${spec.id}`;
    const name = `Personal/${spec.section}${marker}`;
    markers.push({ marker, tagged: spec.tagged, name });

    pages.push({
      name,
      originalName: name,
      properties: spec.tagged ? { website: `[[${SITE}]]` } : {},
    });
    blocksByPage[name] = [{
      content: `- ${spec.section} ${marker}`,
      properties: {
        ...(spec.tagged ? { website: `[[${SITE}]]` } : {}),
        note: `private ${marker}`,
      },
      children: [{ content: `- detail ${marker}`, properties: {} }],
    }];
  });

  return { reader: new FixtureGraphReader({ pages, blocksByPage }), markers };
}

async function exportGraph(reader) {
  logseq.Assets.makeSandboxStorage.mockReturnValue({
    setItem: vi.fn().mockResolvedValue(undefined),
    getItem: vi.fn(),
  });
  const { files } = await runExport({ reader, now: FIXED_NOW });
  return files;
}

describe('the Personal/ privacy boundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  test('an untagged Personal/ page never contributes a byte to any output', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(personalPage, { minLength: 1, maxLength: 6 }), async (specs) => {
        const { reader, markers } = buildGraph(specs);
        const files = await exportGraph(reader);
        const everything = Object.values(files).join('\n');

        for (const { marker, tagged } of markers) {
          if (!tagged) expect(everything).not.toContain(marker);
        }
      }),
      { numRuns: 60 },
    );
  });

  test('tagged pages do reach the output, so the invariant is not vacuous', async () => {
    // Without this, a plugin that exported nothing at all would pass the
    // property above perfectly.
    await fc.assert(
      fc.asyncProperty(fc.array(personalPage, { minLength: 1, maxLength: 6 }), async (specs) => {
        const { reader, markers } = buildGraph(specs);
        const files = await exportGraph(reader);
        const personal = files['personal.yml'];

        for (const { marker, tagged } of markers) {
          if (tagged) expect(personal).toContain(marker.toLowerCase());
        }
      }),
      { numRuns: 60 },
    );
  });

  test('adding an untagged page changes nothing about the output', async () => {
    // The strongest form: untagged content is not merely absent from the text,
    // it has no influence on the export at all.
    await fc.assert(
      fc.asyncProperty(
        fc.array(personalPage, { minLength: 1, maxLength: 4 }),
        personalPage,
        async (specs, extra) => {
          const withoutExtra = await exportGraph(buildGraph(specs).reader);
          const withExtra = await exportGraph(
            buildGraph([...specs, { ...extra, tagged: false }]).reader,
          );
          expect(withExtra).toEqual(withoutExtra);
        },
      ),
      { numRuns: 40 },
    );
  });

  test('runExport never throws on an arbitrary Personal/ mix', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(personalPage, { maxLength: 8 }), async (specs) => {
        const { reader } = buildGraph(specs);
        await expect(exportGraph(reader)).resolves.toBeDefined();
      }),
      { numRuns: 40 },
    );
  });

  test('a page tagged for a different site is treated as untagged', async () => {
    const name = 'Personal/Recipes SECRETRECIPE';
    const reader = new FixtureGraphReader({
      pages: [{ name, originalName: name, properties: { website: '[[someone-else.net]]' } }],
      blocksByPage: {
        [name]: [{
          content: '- Recipes SECRETRECIPE',
          properties: { website: '[[someone-else.net]]' },
        }],
      },
    });

    const files = await exportGraph(reader);

    expect(Object.values(files).join('\n')).not.toContain('SECRETRECIPE');
  });
});
