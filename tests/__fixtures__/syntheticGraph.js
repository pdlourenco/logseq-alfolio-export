// The committed synthetic graph.
//
// Used by two things: the permutation-invariance property test, and the sample
// export that the cross-repo CI job feeds to the site's transform (#10).
//
// It is SYNTHETIC by standing decision — the real graph capture is private and
// never committed, so nothing here may be derived from it. Names are invented.
//
// Several entries look redundant and are not. Each one is a regression for a
// specific cross-repo failure that has already happened once, and is marked
// with the decision it guards. Trimming them is how the guard silently stops
// guarding.

/** Every link key `transformProfile` knows about. */
const ALL_LINK_KEYS = [
  'web', 'linkedin', 'twitter', 'github', 'instagram',
  'lastfm', 'soundcloud', 'orcid', 'scholar', 'researchgate',
  'cienciavitae', 'publons',
];

const cvEntry = (properties, content) => ({ content, properties });

function profileBlock() {
  const properties = {
    'name-long': 'Alex Doe',
    'name-short': 'Alex',
    initials: 'AD',
    'email-personal': 'alex@example.com',
    'email-work': 'alex@work.example.com',
    'bio-short': 'Short bio.',
    'bio-long': 'A slightly longer bio.',
  };

  // REGRESSION (#10, unmapped-key guard): the profile must carry EVERY key in
  // linkKeys. The site's build_socials raises TransformError on any profile key
  // it has no mapping for, so a key the plugin learns before the site maps it
  // fails the build. This fixture is what turns that from a note in a comment
  // thread into a red PR. Do not trim it to "a representative few".
  for (const key of ALL_LINK_KEYS) {
    properties[key] = `[alexdoe](https://${key}.example.com/alexdoe)`;
  }

  // REGRESSION (D28, absent-from-a-mapping half): a link value that is NOT a
  // markdown link becomes {id, url: null}, and a null inside a mapping is
  // dropped. Its partner — null emitted inside a list item — is covered by the
  // experience entry below.
  properties.github = 'alexdoe';

  return cvEntry(properties, '- Profile');
}

function buildSyntheticGraph({ site = 'plourenco.eu' } = {}) {
  const cvBlocks = {
    'CV/Experience': [
      cvEntry(
        { type: '[[experience]]', position: 'Engineer', organization: '[[Orbital Systems]]', start: '[[2019/03]]', description: 'Did the thing.' },
        '- Engineer',
      ),
      cvEntry(
        { type: '[[experience]]', position: 'Researcher', organization: '[[UDEX]]', start: '[[2022/01]]' },
        '- Researcher',
      ),
      // REGRESSION (D28, null-in-a-list half): no description::, so the entry
      // serialises with an explicit `description: null` inside a list item.
      cvEntry(
        { type: '[[experience]]', position: 'Intern', organization: '[[Orbital Systems]]', start: '[[2016/06]]' },
        '- Intern',
      ),
    ],
    'CV/Education': [
      cvEntry({ type: '[[education]]', degree: 'PhD', field: 'Robotics', university: '[[UDEX]]', start: '[[2018/09]]' }, '- PhD'),
      cvEntry({ type: '[[education]]', degree: 'MSc', field: 'Engineering', university: '[[UDEX]]', start: '[[2015/09]]' }, '- MSc'),
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
      cvEntry({ type: '[[language]]', speaking: '5', understanding: '5', writing: '5', 'mother-tongue': 'true' }, '- Portuguese'),
      cvEntry({ type: '[[language]]', speaking: '4', understanding: '5', writing: '4' }, '- English'),
    ],
    'CV/Research Interests': [
      cvEntry({ type: '[[research-interest]]', group: 'Robotics', level: '5' }, '- Estimation'),
      cvEntry({ type: '[[research-interest]]', group: 'Robotics', level: '4' }, '- Control'),
    ],
    'CV/Profile': [profileBlock()],
    [`${site}/Publication Overrides`]: [
      cvEntry({ type: '[[publication-override]]', selected: 'true', abbr: 'ICRA' }, '- doe2024navigation'),
      cvEntry({ type: '[[publication-override]]', selected: 'false' }, '- doe2022estimation'),
    ],
  };

  const standalone = [
    { name: 'Ana Silva', type: 'student', start: '[[2021/09]]' },
    { name: 'Bruno Costa', type: 'student', start: '[[2019/09]]' },
    { name: 'Nav Filter', type: 'project', start: '[[2022/01]]' },
    { name: 'Sim Pipeline', type: 'project', start: '[[2020/04]]' },
  ].map(({ name, type, start }) => ({
    page: { name, originalName: name, properties: { website: `[[${site}]]` } },
    blocks: [{
      content: `- ${name}`,
      properties: {
        website: `[[${site}]]`,
        type: `[[${type}]]`,
        start,
        ...(type === 'student'
          ? { university: '[[UDEX]]', supervisor: 'Prof. [[Miguel Antunes]]', 'thesis-type': 'MSc' }
          // The projects rule: the graph owns the record, the repo owns the
          // write-up, and url:: is the link between them.
          : { url: '/projects/' + name.toLowerCase().replace(/\s+/g, '-'), importance: '1' }),
      },
    }],
  }));

  // REGRESSION (D55): sections are in NON-ALPHABETICAL authored order. Block
  // order within a page is editorial and must survive; the page keys around
  // them are sorted, because getAllPages order is an index artifact with no
  // authored order to preserve. Reordering these to alphabetical would make
  // the fixture unable to tell the two apart.
  const personal = [
    {
      name: 'Personal/DIY',
      sections: [
        ['## Tools', [{ content: '- Bandsaw', properties: { brand: 'Example' } }]],
        ['## Projects', [{ content: '- Bookshelf', properties: { year: '2024' } }]],
      ],
    },
    {
      name: 'Personal/Music',
      sections: [
        ['## Instruments', [{ content: '- Bass', properties: { since: '2005' } }]],
        ['## Bands', [{ content: '- Example Band', properties: { role: 'bass' } }]],
      ],
    },
  ].map(({ name, sections }) => {
    const children = [];
    for (const [header, entries] of sections) {
      children.push({ content: header, properties: {} });
      children.push(...entries);
    }
    return {
      page: { name, originalName: name, properties: { website: `[[${site}]]` } },
      blocks: [{
        content: `- ${name.replace('Personal/', '')}`,
        properties: { website: `[[${site}]]`, description: 'A personal page.' },
        children,
      }],
    };
  });

  // Logseq creates a page for every [[ref]] that is written, including type
  // values and journal dates. Without them the export is correct but the lint
  // reports dozens of unresolved refs, and a sample that is noisy by
  // construction is one where a real new warning goes unnoticed.
  const referencedPages = [
    site,
    'experience', 'education', 'award', 'skill', 'language',
    'research-interest', 'student', 'project', 'person', 'publication-override',
    '2015/09', '2016/06', '2018/09', '2019/03', '2019/09', '2019/11',
    '2020/04', '2021/05', '2021/09', '2022/01',
  ].map((name) => ({ name, originalName: name, properties: {} }));

  // Support pages: icons, an abbreviation, and a person with an affiliation, so
  // alias expansion and supervisor resolution are actually exercised.
  const supportPages = [
    { name: 'Universidade do Exemplo', originalName: 'Universidade do Exemplo', properties: { icon: 'udex', abbreviation: 'UDEX', alias: 'UDEX' } },
    { name: 'Orbital Systems', originalName: 'Orbital Systems', properties: { icon: 'orbital' } },
    { name: 'Miguel Antunes', originalName: 'Miguel Antunes', properties: { type: '[[person]]', affiliation: '[[Universidade do Exemplo]]' } },
  ];

  return {
    pages: [
      ...referencedPages, ...supportPages,
      ...standalone.map((s) => s.page), ...personal.map((p) => p.page),
    ],
    blocksByPage: {
      ...cvBlocks,
      ...Object.fromEntries([...standalone, ...personal].map((e) => [e.page.originalName, e.blocks])),
    },
  };
}

module.exports = { buildSyntheticGraph, ALL_LINK_KEYS };
