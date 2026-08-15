// The graph-reading seam and the capture command.
//
// Capture is the empirical bridge: the only way to learn what Logseq actually
// hands a plugin. Its safety property is the one that matters most here — the
// shareable summary must carry structure and no content, because the whole
// point is that it can be pasted somewhere the raw dump never should be.

const {
  FileGraphReader,
  FixtureGraphReader,
  redactToShape,
  summariseShapes,
  runCapture,
  runExport,
  CAPTURE_PREFIX,
} = require('../../index.js');

describe('FixtureGraphReader', () => {
  test('serves pages and blocks from a captured dump', async () => {
    const reader = new FixtureGraphReader({
      pages: [{ name: 'A', originalName: 'A' }],
      blocksByPage: { A: [{ content: '- x' }] },
    });

    expect(await reader.readAllPages()).toEqual([{ name: 'A', originalName: 'A' }]);
    expect(await reader.readPageBlocksTree('A')).toEqual([{ content: '- x' }]);
  });

  test('returns empty for an unknown page rather than throwing', async () => {
    const reader = new FixtureGraphReader({});
    expect(await reader.readAllPages()).toEqual([]);
    expect(await reader.readPageBlocksTree('missing')).toEqual([]);
    expect(await reader.query('[:find ?b]')).toEqual([]);
  });

  test('runs the whole export with no logseq global reads', async () => {
    // The seam's reason for existing: the pipeline works off a dump.
    const reader = new FixtureGraphReader({
      pages: [{ name: 'Ana', originalName: 'Ana', properties: { website: '[[plourenco.eu]]' } }],
      blocksByPage: {
        Ana: [{
          content: '- Ana',
          properties: { website: '[[plourenco.eu]]', type: '[[project]]', start: '[[2024/01]]' },
        }],
      },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    logseq.Assets.makeSandboxStorage.mockReturnValue({
      setItem: vi.fn().mockResolvedValue(undefined), getItem: vi.fn(),
    });

    const { files } = await runExport({ reader, now: new Date('2026-03-01T12:00:00.000Z') });

    expect(files['cv.yml']).toContain('Ana');
    expect(logseq.Editor.getAllPages).not.toHaveBeenCalled();
    expect(logseq.Editor.getPageBlocksTree).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('FileGraphReader', () => {
  test('normalises a null response to an empty list', async () => {
    logseq.Editor.getAllPages.mockResolvedValue(null);
    logseq.Editor.getPageBlocksTree.mockResolvedValue(null);
    logseq.DB.datascriptQuery.mockResolvedValue(null);
    const reader = new FileGraphReader();

    expect(await reader.readAllPages()).toEqual([]);
    expect(await reader.readPageBlocksTree('X')).toEqual([]);
    expect(await reader.query('[:find ?b]')).toEqual([]);
  });
});

describe('redactToShape', () => {
  test.each([
    ['Prof. [[Pedro Batista]]', 'aaaa. [[aaaaa aaaaaaa]]'],
    ['[[2022/07/15]]', '[[9999/99/99]]'],
    ['[[2022]]', '[[9999]]'],
    ['[label](https://example.com)', '[aaaaa](aaaaa://aaaaaaa.aaa)'],
    ['[[A]], [[B]]', '[[a]], [[a]]'],
  ])('keeps the structure of %s and none of the content', (input, expected) => {
    expect(redactToShape(input)).toBe(expected);
  });

  test('preserves accented letters as letters, not as content', () => {
    expect(redactToShape('Instituto Superior Técnico')).toBe('aaaaaaaaa aaaaaaaa aaaaaaa');
  });

  test('describes non-strings by type', () => {
    expect(redactToShape(42)).toBe('number');
    expect(redactToShape(true)).toBe('boolean');
    expect(redactToShape(null)).toBe('null');
    expect(redactToShape(['[[A]]', '[[B]]'])).toBe('[[[a]], [[a]]]');
  });

  test('leaks no original alphanumeric content', () => {
    const secret = 'Gil Serrano 1234 supervisor';
    const shape = redactToShape(secret);
    for (const word of ['Gil', 'Serrano', '1234', 'supervisor']) {
      expect(shape).not.toContain(word);
    }
  });

  test('leaves no letter or digit of any script behind', () => {
    // The general form of the accented-letter bug: an ASCII-only redaction
    // silently passes through exactly the characters this graph is full of.
    const shape = redactToShape('Tomás Aguiar — Técnico 2024 · Ωmega');
    expect(shape).not.toMatch(/[^\P{L}a]/u);   // no letters other than 'a'
    expect(shape).not.toMatch(/[^\P{N}9]/u);   // no digits other than '9'
  });
});

describe('summariseShapes', () => {
  test('records the JS type each key arrives as', () => {
    const summary = summariseShapes([
      { source: 'block:A', properties: { type: '[[student]]' } },
      { source: 'block:B', properties: { type: ['student'] } },
    ]);
    expect(summary.type.types).toEqual({ string: 1, array: 1 });
    expect(summary.type.occurrences).toBe(2);
  });

  test('keeps key names exactly as received, so normalisation is visible', () => {
    const summary = summariseShapes([
      { source: 'block:A', properties: { 'thesis-type': 'MSc', thesisType: 'MSc' } },
    ]);
    expect(Object.keys(summary)).toEqual(['thesis-type', 'thesisType']);
  });

  test('caps samples so a large graph cannot bloat the summary', () => {
    const samples = Array.from({ length: 50 }, (_, i) => ({
      source: `block:${i}`,
      properties: { start: `[[20${String(i).padStart(2, '0')}]]` },
    }));
    const summary = summariseShapes(samples);
    expect(summary.start.shapes.length).toBeLessThanOrEqual(3);
    expect(summary.start.seenOn.length).toBeLessThanOrEqual(3);
    expect(summary.start.occurrences).toBe(50);
  });
});

describe('runCapture', () => {
  let storage;
  let stored;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stored = {};
    storage = {
      setItem: vi.fn(async (key, value) => { stored[key] = value; }),
      getItem: vi.fn(async (key) => stored[key] ?? null),
    };
    logseq.Assets.makeSandboxStorage.mockReturnValue(storage);
  });

  afterEach(() => vi.restoreAllMocks());

  const graph = () => new FixtureGraphReader({
    pages: [
      { name: 'CV/Experience', originalName: 'CV/Experience', properties: {} },
      { name: 'Personal/Diary', originalName: 'Personal/Diary', properties: { secretkey: 'Confidential Text' } },
    ],
    blocksByPage: {
      'CV/Experience': [{
        content: '- Engineer',
        properties: { type: '[[experience]]', start: '[[2019/03]]' },
        children: [{ content: '- child', properties: { 'thesis-type': 'MSc' } }],
      }],
      'Personal/Diary': [{ content: '- private thoughts', properties: { mood: 'Anxious' } }],
    },
  });

  test('writes both artefacts under the capture prefix', async () => {
    await runCapture({ reader: graph(), now: new Date('2026-03-01T12:00:00.000Z') });

    expect(Object.keys(stored)).toContain(`${CAPTURE_PREFIX}/dump.json`);
    expect(Object.keys(stored)).toContain(`${CAPTURE_PREFIX}/shapes.json`);
  });

  test('the shareable summary contains no graph content', async () => {
    // The property that lets the summary be pasted where the dump cannot.
    await runCapture({ reader: graph(), now: new Date('2026-03-01T12:00:00.000Z') });
    const shapes = stored[`${CAPTURE_PREFIX}/shapes.json`];

    for (const secret of ['Confidential', 'Anxious', 'private thoughts', 'Engineer']) {
      expect(shapes).not.toContain(secret);
    }
    // Key names are structure, and are kept — that is the point.
    expect(shapes).toContain('thesis-type');
    expect(shapes).toContain('secretkey');
  });

  test('page names in seenOn are redacted too', async () => {
    // The failure mode this guards: every *value* redacts to `aaaaaaa`, so the
    // file looks safe at a glance, and the one unredacted field is the one
    // nobody checks before pasting it somewhere public.
    const shapes = await runCapture({ reader: graph(), now: new Date('2026-03-01T12:00:00.000Z') });
    const sources = Object.values(shapes.property_keys).flatMap((entry) => entry.seenOn);

    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).not.toContain('Diary');
      expect(source).not.toContain('Personal');
      expect(source).not.toContain('Experience');
      // Only the page/block/child prefix, then redacted structure.
      expect(source).toMatch(/^(page|block|child):[^A-Za-z0-9]*[a9\W]*$/u);
    }
  });

  test('seenOn still shows where a property lives and how deep the namespace is', async () => {
    // Redaction must not cost the diagnostic value: the prefix and the
    // namespace separator are what make this field worth keeping.
    const shapes = await runCapture({ reader: graph(), now: new Date('2026-03-01T12:00:00.000Z') });

    expect(shapes.property_keys.type.seenOn[0]).toBe('block:aa/aaaaaaaaaa');
    expect(shapes.property_keys['thesis-type'].seenOn[0]).toBe('child:aa/aaaaaaaaaa');
    expect(shapes.property_keys.mood.seenOn[0]).toBe('block:aaaaaaaa/aaaaa');
  });

  test('the raw dump does contain content, which is why it stays local', async () => {
    await runCapture({ reader: graph(), now: new Date('2026-03-01T12:00:00.000Z') });
    expect(stored[`${CAPTURE_PREFIX}/dump.json`]).toContain('Confidential Text');
  });

  test('covers page, block and child properties', async () => {
    const shapes = await runCapture({ reader: graph(), now: new Date('2026-03-01T12:00:00.000Z') });
    expect(Object.keys(shapes.property_keys).sort())
      .toEqual(['mood', 'secretkey', 'start', 'thesis-type', 'type']);
  });

  test('probes whether nested storage keys round-trip', async () => {
    const shapes = await runCapture({ reader: graph(), now: new Date('2026-03-01T12:00:00.000Z') });

    expect(shapes.nested_key_support.key).toBe(`${CAPTURE_PREFIX}/probe/nested.json`);
    expect(shapes.nested_key_support.roundTrips).toBe(true);
  });

  test('reports a storage that rejects nested keys instead of throwing', async () => {
    // What the probe exists to detect: runExport writes blog/*.md as nested
    // keys, so a storage that refuses them has been losing blog posts.
    storage.setItem.mockImplementation(async (key) => {
      if (key.includes('/probe/')) throw new Error('nested keys unsupported');
    });

    const shapes = await runCapture({ reader: graph(), now: new Date('2026-03-01T12:00:00.000Z') });

    expect(shapes.nested_key_support.roundTrips).toBe(false);
    expect(shapes.nested_key_support.error).toMatch(/nested keys unsupported/);
  });

  test('reports failure rather than half-succeeding', async () => {
    const reader = { readAllPages: async () => { throw new Error('graph unavailable'); } };
    await expect(runCapture({ reader })).rejects.toThrow('graph unavailable');
    expect(logseq.UI.showMsg).toHaveBeenCalledWith(
      expect.stringContaining('capture failed'), 'error',
    );
  });
});
