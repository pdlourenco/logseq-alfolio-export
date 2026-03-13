const { extractNamespaceEntries, findWebsitePages } = require('../../index.js');
const { EXPERIENCE_BLOCKS, TEMPLATE_BLOCK } = require('../__fixtures__/blocks.fixture.js');

describe('extractNamespaceEntries', () => {
  test('returns empty array when getPageBlocksTree returns null', async () => {
    logseq.Editor.getPageBlocksTree.mockResolvedValue(null);
    const result = await extractNamespaceEntries('CV/Experience', {});
    expect(result).toEqual([]);
  });

  test('returns empty array when getPageBlocksTree returns empty array', async () => {
    logseq.Editor.getPageBlocksTree.mockResolvedValue([]);
    const result = await extractNamespaceEntries('CV/Experience', {});
    expect(result).toEqual([]);
  });

  test('skips blocks with no properties', async () => {
    const blocks = [
      { content: 'Just text', properties: {} },
      { content: 'Also text', properties: null },
    ];
    logseq.Editor.getPageBlocksTree.mockResolvedValue(blocks);
    const result = await extractNamespaceEntries('CV/Experience', {});
    expect(result).toHaveLength(0);
  });

  test('skips template blocks', async () => {
    logseq.Editor.getPageBlocksTree.mockResolvedValue([TEMPLATE_BLOCK]);
    const result = await extractNamespaceEntries('CV/Experience', {});
    expect(result).toHaveLength(0);
  });

  test('includes blocks with properties', async () => {
    logseq.Editor.getPageBlocksTree.mockResolvedValue(EXPERIENCE_BLOCKS);
    const result = await extractNamespaceEntries('CV/Experience', {});
    // EXPERIENCE_BLOCKS has 3 blocks, all have properties (none are template)
    expect(result).toHaveLength(3);
  });

  test('adds _blockContent from block.content', async () => {
    logseq.Editor.getPageBlocksTree.mockResolvedValue(EXPERIENCE_BLOCKS);
    const result = await extractNamespaceEntries('CV/Experience', {});
    expect(result[0]._blockContent).toBe(EXPERIENCE_BLOCKS[0].content);
  });

  test('includes properties on entry', async () => {
    logseq.Editor.getPageBlocksTree.mockResolvedValue(EXPERIENCE_BLOCKS);
    const result = await extractNamespaceEntries('CV/Experience', {});
    expect(result[0].type).toBe('experience');
    expect(result[0].position).toBe('Researcher');
  });

  test('includes children with type property', async () => {
    const parentBlock = {
      content: 'Parent\ntype:: parent',
      properties: { type: 'parent' },
      children: [
        {
          content: 'Child\ntype:: child\nname:: test',
          properties: { type: 'child', name: 'test' },
        },
        {
          // Child without type — should be skipped
          content: 'Child no type\nname:: skip',
          properties: { name: 'skip' },
        },
      ],
    };
    logseq.Editor.getPageBlocksTree.mockResolvedValue([parentBlock]);
    const result = await extractNamespaceEntries('TestPage', {});
    // Parent + 1 child with type (the other child without type is skipped)
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe('child');
  });

  test('skips blocks with content starting with #', async () => {
    const commentBlock = {
      content: '# This is a header/comment',
      properties: { type: 'experience' },
      children: [],
    };
    logseq.Editor.getPageBlocksTree.mockResolvedValue([commentBlock]);
    const result = await extractNamespaceEntries('CV/Experience', {});
    expect(result).toHaveLength(0);
  });
});

describe('findWebsitePages', () => {
  test('returns empty array when datascriptQuery returns null', async () => {
    logseq.DB.datascriptQuery.mockResolvedValue(null);
    const result = await findWebsitePages({});
    expect(result).toEqual([]);
  });

  test('returns empty array when datascriptQuery returns empty', async () => {
    logseq.DB.datascriptQuery.mockResolvedValue([]);
    const result = await findWebsitePages({});
    expect(result).toEqual([]);
  });

  test('filters results to those matching websiteName', async () => {
    logseq.DB.datascriptQuery.mockResolvedValue([
      [{ properties: { website: 'plourenco.eu' } }],
      [{ properties: { website: 'other-site.com' } }],
    ]);
    const result = await findWebsitePages({});
    expect(result).toHaveLength(1);
    expect(result[0].properties.website).toBe('plourenco.eu');
  });

  test('falls back gracefully when datascriptQuery throws', async () => {
    logseq.DB.datascriptQuery.mockRejectedValue(new Error('DB error'));
    const result = await findWebsitePages({});
    expect(result).toEqual([]);
  });
});
