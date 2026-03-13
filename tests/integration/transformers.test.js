const {
  ResolutionCache,
  transformExperience,
  transformEducation,
  transformAwards,
  transformSkills,
  transformLanguages,
  transformResearchInterests,
  transformStudents,
  transformProjects,
  transformProfile,
  transformPublicationOverrides,
} = require('../../index.js');
const { PAGES_FIXTURE } = require('../__fixtures__/pages.fixture.js');
const {
  EXPERIENCE_BLOCKS,
  EDUCATION_BLOCKS,
  AWARDS_BLOCKS,
  SKILLS_BLOCKS,
  LANGUAGES_BLOCKS,
  RESEARCH_INTERESTS_BLOCKS,
  PROFILE_BLOCKS,
  STUDENT_BLOCKS,
  PROJECT_BLOCKS,
  PUB_OVERRIDE_BLOCKS,
} = require('../__fixtures__/blocks.fixture.js');

let cache;

beforeEach(async () => {
  logseq.Editor.getAllPages.mockResolvedValue(PAGES_FIXTURE);
  cache = new ResolutionCache();
  await cache.build();
});

// Simulate extractNamespaceEntries output (adds _blockContent)
function toEntries(blocks) {
  return blocks.map((b) => ({ _blockContent: b.content, ...b.properties }));
}

describe('transformExperience', () => {
  test('returns only experience-type entries', () => {
    const entries = toEntries(EXPERIENCE_BLOCKS);
    const result = transformExperience(entries, cache);
    expect(result.every((e) => e.position !== undefined)).toBe(true);
  });

  test('filters out entries without position', () => {
    const entries = toEntries(EXPERIENCE_BLOCKS);
    const result = transformExperience(entries, cache);
    // EXPERIENCE_BLOCKS[1] has no position, EXPERIENCE_BLOCKS[2] is education type
    expect(result).toHaveLength(1);
  });

  test('resolves organization name through cache', () => {
    const entries = toEntries(EXPERIENCE_BLOCKS);
    const result = transformExperience(entries, cache);
    expect(result[0].organization).toBe('University of Porto');
  });

  test('converts date format', () => {
    const entries = toEntries(EXPERIENCE_BLOCKS);
    const result = transformExperience(entries, cache);
    expect(result[0].start).toBe('2020-01');
    expect(result[0].end).toBe('2023-12');
  });

  test('fetches icon from cache', () => {
    const entries = toEntries(EXPERIENCE_BLOCKS);
    const result = transformExperience(entries, cache);
    expect(result[0].icon).toBe('up');
  });

  test('preserves location', () => {
    const entries = toEntries(EXPERIENCE_BLOCKS);
    const result = transformExperience(entries, cache);
    expect(result[0].location).toBe('Porto, Portugal');
  });
});

describe('transformEducation', () => {
  test('returns only education-type entries', () => {
    const entries = toEntries(EDUCATION_BLOCKS);
    const result = transformEducation(entries, cache);
    expect(result).toHaveLength(2);
  });

  test('filters out entries without degree', () => {
    const noDegree = [{ _blockContent: 'type:: education', type: 'education' }];
    const result = transformEducation(noDegree, cache);
    expect(result).toHaveLength(0);
  });

  test('converts dates', () => {
    const entries = toEntries(EDUCATION_BLOCKS);
    const result = transformEducation(entries, cache);
    expect(result[0].start).toBe('2016-09');
    expect(result[0].end).toBe('2020-12');
  });

  test('parses advisors with parsePeopleRefs', () => {
    const entries = toEntries(EDUCATION_BLOCKS);
    const result = transformEducation(entries, cache);
    expect(result[0].advisors).toEqual(['Prof. Paulo Oliveira']);
  });

  test('handles missing advisors', () => {
    const entries = toEntries(EDUCATION_BLOCKS);
    const result = transformEducation(entries, cache);
    expect(result[1].advisors).toBeNull();
  });

  test('resolves university through cache', () => {
    const entries = toEntries(EDUCATION_BLOCKS);
    const result = transformEducation(entries, cache);
    expect(result[0].university).toContain('University of Porto');
  });
});

describe('transformAwards', () => {
  test('returns only award-type entries with title', () => {
    const entries = toEntries(AWARDS_BLOCKS);
    const result = transformAwards(entries, cache);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Best Paper Award');
  });

  test('filters out entries without title', () => {
    const noTitle = [{ _blockContent: 'type:: award', type: 'award', awarder: ['University of Minho'] }];
    const result = transformAwards(noTitle, cache);
    expect(result).toHaveLength(0);
  });

  test('resolves awarder name', () => {
    const entries = toEntries(AWARDS_BLOCKS);
    const result = transformAwards(entries, cache);
    expect(result[0].awarder).toBe('University of Porto');
  });

  test('converts date', () => {
    const entries = toEntries(AWARDS_BLOCKS);
    const result = transformAwards(entries, cache);
    expect(result[0].date).toBe('2021-06');
  });

  test('gets icon for awarder', () => {
    const entries = toEntries(AWARDS_BLOCKS);
    const result = transformAwards(entries, cache);
    expect(result[0].icon).toBe('up');
  });
});

describe('transformSkills', () => {
  test('returns skill entries with name from block title', () => {
    const entries = toEntries(SKILLS_BLOCKS);
    const result = transformSkills(entries, cache);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Python');
    expect(result[1].name).toBe('JavaScript');
  });

  test('parses level as integer', () => {
    const entries = toEntries(SKILLS_BLOCKS);
    const result = transformSkills(entries, cache);
    expect(result[0].level).toBe(5);
    expect(result[1].level).toBe(4);
  });

  test('includes group', () => {
    const entries = toEntries(SKILLS_BLOCKS);
    const result = transformSkills(entries, cache);
    expect(result[0].group).toBe('Programming');
  });
});

describe('transformLanguages', () => {
  test('returns language entries with name from block title', () => {
    const entries = toEntries(LANGUAGES_BLOCKS);
    const result = transformLanguages(entries, cache);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Portuguese');
    expect(result[1].name).toBe('English');
  });

  test('mother_tongue flag from "true" string', () => {
    const entries = toEntries(LANGUAGES_BLOCKS);
    const result = transformLanguages(entries, cache);
    expect(result[0].mother_tongue).toBe(true);
    expect(result[1].mother_tongue).toBe(false);
  });

  test('parses proficiency levels as integers', () => {
    const entries = toEntries(LANGUAGES_BLOCKS);
    const result = transformLanguages(entries, cache);
    expect(result[1].speaking).toBe(5);
    expect(result[1].understanding).toBe(5);
    expect(result[1].writing).toBe(5);
  });
});

describe('transformResearchInterests', () => {
  test('returns research-interest entries', () => {
    const entries = toEntries(RESEARCH_INTERESTS_BLOCKS);
    const result = transformResearchInterests(entries, cache);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Machine Learning');
  });

  test('parses level as integer', () => {
    const entries = toEntries(RESEARCH_INTERESTS_BLOCKS);
    const result = transformResearchInterests(entries, cache);
    expect(result[0].level).toBe(3);
  });
});

describe('transformStudents', () => {
  test('separates supervised from jury entries', () => {
    const { supervised, jury } = transformStudents(STUDENT_BLOCKS, cache);
    // Alice and Bob are supervised (no jury-role), Carol is jury (Examiner)
    expect(supervised).toHaveLength(2);
    expect(jury).toHaveLength(1);
  });

  test('extracts student name from block content', () => {
    const { supervised } = transformStudents(STUDENT_BLOCKS, cache);
    expect(supervised[0].name).toBe('Alice Example');
    expect(supervised[1].name).toBe('Bob Tester');
  });

  test('resolves university name', () => {
    const { supervised } = transformStudents(STUDENT_BLOCKS, cache);
    expect(supervised[0].university).toContain('University of Porto');
  });

  test('status is "completed" when end date present', () => {
    const { supervised } = transformStudents(STUDENT_BLOCKS, cache);
    // Alice has end date
    expect(supervised[0].status).toBe('completed');
  });

  test('status is "current" when no end date', () => {
    const { supervised } = transformStudents(STUDENT_BLOCKS, cache);
    // Bob has no end date
    expect(supervised[1].status).toBe('current');
  });

  test('supervisor at same university — no affiliation annotation', () => {
    const { supervised } = transformStudents(STUDENT_BLOCKS, cache);
    // Alice: supervisor Paulo Oliveira is at University of Porto (same as student)
    expect(supervised[0].supervisors[0]).not.toContain('(');
  });

  test('supervisor at different university — affiliation annotation added', () => {
    const { supervised } = transformStudents(STUDENT_BLOCKS, cache);
    // Bob: supervisor John Smith is at University of Minho, student at University of Porto
    expect(supervised[1].supervisors[0]).toContain('(UMinho)');
  });

  test('jury entry has jury_role', () => {
    const { jury } = transformStudents(STUDENT_BLOCKS, cache);
    expect(jury[0].jury_role).toBe('Examiner');
  });

  test('icon from university cache', () => {
    const { supervised } = transformStudents(STUDENT_BLOCKS, cache);
    expect(supervised[0].icon).toBe('up');
  });

  test('converts dates', () => {
    const { supervised } = transformStudents(STUDENT_BLOCKS, cache);
    expect(supervised[0].start).toBe('2022-09');
    expect(supervised[0].end).toBe('2023-07');
  });
});

describe('transformProjects', () => {
  test('returns project entries with name', () => {
    const result = transformProjects(PROJECT_BLOCKS, cache);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('My Cool Project');
  });

  test('resolves institution name', () => {
    const result = transformProjects(PROJECT_BLOCKS, cache);
    expect(result[0].institution).toBe('University of Porto');
  });

  test('converts dates', () => {
    const result = transformProjects(PROJECT_BLOCKS, cache);
    expect(result[0].start).toBe('2021-01');
    expect(result[0].end).toBe('2022-12');
  });
});

describe('transformProfile', () => {
  test('maps simple keys to underscore format', () => {
    const entries = toEntries(PROFILE_BLOCKS);
    const result = transformProfile(entries, cache);
    expect(result.name_long).toBe('John Doe');
    expect(result.name_short).toBe('J. Doe');
    expect(result.initials).toBe('JD');
    expect(result.email_personal).toBe('john@example.com');
  });

  test('parses markdown links into {id, url}', () => {
    const entries = toEntries(PROFILE_BLOCKS);
    const result = transformProfile(entries, cache);
    expect(result.github).toEqual({ id: 'johndoe', url: 'https://github.com/johndoe' });
  });

  test('returns empty object for empty entries', () => {
    const result = transformProfile([], cache);
    expect(result).toEqual({});
  });
});

describe('transformPublicationOverrides', () => {
  test('keys by cite-key', () => {
    const entries = toEntries(PUB_OVERRIDE_BLOCKS);
    const result = transformPublicationOverrides(entries, cache);
    expect(result['doe2021']).toBeDefined();
  });

  test('selected string "true" → boolean true', () => {
    const entries = toEntries(PUB_OVERRIDE_BLOCKS);
    const result = transformPublicationOverrides(entries, cache);
    expect(result['doe2021'].selected).toBe(true);
  });

  test('includes abbr field', () => {
    const entries = toEntries(PUB_OVERRIDE_BLOCKS);
    const result = transformPublicationOverrides(entries, cache);
    expect(result['doe2021'].abbr).toBe('ICML');
  });

  test('entries without cite-key are skipped', () => {
    const entries = [{ _blockContent: 'type:: publication-override', type: 'publication-override' }];
    const result = transformPublicationOverrides(entries, cache);
    expect(Object.keys(result)).toHaveLength(0);
  });
});
