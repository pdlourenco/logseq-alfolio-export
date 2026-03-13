// Represents output of logseq.Editor.getPageBlocksTree() for various pages.
// Properties mirror Logseq's actual format: [[refs]] sometimes parsed as arrays.

// CV/Experience
const EXPERIENCE_BLOCKS = [
  {
    id: 1,
    content: 'type:: experience\norganization:: [[University of Porto]]\nposition:: Researcher\nstart:: [[2020/01]]\nend:: [[2023/12]]\nlocation:: Porto, Portugal',
    properties: {
      type: 'experience',
      organization: ['University of Porto'],
      position: 'Researcher',
      start: '[[2020/01]]',
      end: '[[2023/12]]',
      location: 'Porto, Portugal',
    },
    children: [],
  },
  // Entry without position — should be filtered out
  {
    id: 2,
    content: 'type:: experience\norganization:: [[University of Minho]]\nstart:: [[2019/01]]',
    properties: {
      type: 'experience',
      organization: ['University of Minho'],
      start: '[[2019/01]]',
    },
    children: [],
  },
  // Non-experience block — should be filtered out
  {
    id: 3,
    content: 'type:: education\ndegree:: PhD',
    properties: {
      type: 'education',
      degree: 'PhD',
    },
    children: [],
  },
];

// CV/Education
const EDUCATION_BLOCKS = [
  {
    id: 10,
    content: 'type:: education\ndegree:: PhD\nfield:: Computer Science\nuniversity:: [[University of Porto]]\nstart:: [[2016/09]]\nend:: [[2020/12]]\nthesis-title:: Some Thesis Title\nadvisors:: Prof. [[Paulo Oliveira]]',
    properties: {
      type: 'education',
      degree: 'PhD',
      field: 'Computer Science',
      university: ['University of Porto'],
      start: '[[2016/09]]',
      end: '[[2020/12]]',
      'thesis-title': 'Some Thesis Title',
      advisors: 'Prof. [[Paulo Oliveira]]',
    },
    children: [],
  },
  {
    id: 11,
    content: 'type:: education\ndegree:: MSc\nfield:: Informatics\nuniversity:: [[University of Minho]]\nstart:: [[2014/09]]\nend:: [[2016/07]]',
    properties: {
      type: 'education',
      degree: 'MSc',
      field: 'Informatics',
      university: ['University of Minho'],
      start: '[[2014/09]]',
      end: '[[2016/07]]',
    },
    children: [],
  },
];

// CV/Awards
const AWARDS_BLOCKS = [
  {
    id: 20,
    content: 'Best Paper Award\ntype:: award\nawarder:: [[University of Porto]]\ndate:: [[2021/06]]\ncategory:: Research',
    properties: {
      type: 'award',
      awarder: ['University of Porto'],
      date: '[[2021/06]]',
      category: 'Research',
    },
    children: [],
  },
  // Block without title — filtered out
  {
    id: 21,
    content: 'type:: award\nawarder:: [[University of Minho]]',
    properties: {
      type: 'award',
      awarder: ['University of Minho'],
    },
    children: [],
  },
];

// CV/Skills
const SKILLS_BLOCKS = [
  {
    id: 30,
    content: 'Python\ntype:: skill\ngroup:: Programming\nlevel:: 5',
    properties: {
      type: 'skill',
      group: 'Programming',
      level: '5',
    },
    children: [],
  },
  {
    id: 31,
    content: 'JavaScript\ntype:: skill\ngroup:: Programming\nlevel:: 4',
    properties: {
      type: 'skill',
      group: 'Programming',
      level: '4',
    },
    children: [],
  },
];

// CV/Languages
const LANGUAGES_BLOCKS = [
  {
    id: 40,
    content: 'Portuguese\ntype:: language\nmother-tongue:: true',
    properties: {
      type: 'language',
      'mother-tongue': 'true',
    },
    children: [],
  },
  {
    id: 41,
    content: 'English\ntype:: language\nspeaking:: 5\nunderstanding:: 5\nwriting:: 5',
    properties: {
      type: 'language',
      speaking: '5',
      understanding: '5',
      writing: '5',
    },
    children: [],
  },
];

// CV/Research Interests
const RESEARCH_INTERESTS_BLOCKS = [
  {
    id: 50,
    content: 'Machine Learning\ntype:: research-interest\nlevel:: 3\ngroup:: AI',
    properties: {
      type: 'research-interest',
      level: '3',
      group: 'AI',
    },
    children: [],
  },
];

// CV/Profile
const PROFILE_BLOCKS = [
  {
    id: 60,
    content: 'type:: profile\nname-long:: John Doe\nname-short:: J. Doe\ninitials:: JD\nemail-personal:: john@example.com\ngithub:: [johndoe](https://github.com/johndoe)',
    properties: {
      type: 'profile',
      'name-long': 'John Doe',
      'name-short': 'J. Doe',
      initials: 'JD',
      'email-personal': 'john@example.com',
      github: '[johndoe](https://github.com/johndoe)',
    },
    children: [],
  },
];

// Standalone student pages (with website property)
const STUDENT_BLOCKS = [
  {
    id: 70,
    content: 'Alice Example\ntype:: student\nwebsite:: plourenco.eu\nthesis-type:: MSc\ndegree:: MSc\nuniversity:: [[University of Porto]]\nsupervisor:: Prof. [[Paulo Oliveira]]\nstart:: [[2022/09]]\nend:: [[2023/07]]',
    properties: {
      type: 'student',
      website: 'plourenco.eu',
      'thesis-type': 'MSc',
      degree: 'MSc',
      university: ['University of Porto'],
      supervisor: 'Prof. [[Paulo Oliveira]]',
      start: '[[2022/09]]',
      end: '[[2023/07]]',
    },
    children: [],
  },
  // Student with external supervisor (different university)
  {
    id: 71,
    content: 'Bob Tester\ntype:: student\nwebsite:: plourenco.eu\nthesis-type:: PhD\ndegree:: PhD\nuniversity:: [[University of Porto]]\nsupervisor:: Prof. [[John Smith]]\nstart:: [[2021/01]]',
    properties: {
      type: 'student',
      website: 'plourenco.eu',
      'thesis-type': 'PhD',
      degree: 'PhD',
      university: ['University of Porto'],
      supervisor: 'Prof. [[John Smith]]',
      start: '[[2021/01]]',
    },
    children: [],
  },
  // Jury role: Examiner
  {
    id: 72,
    content: 'Carol Jury\ntype:: student\nwebsite:: plourenco.eu\nthesis-type:: PhD\ndegree:: PhD\nuniversity:: [[University of Minho]]\nsupervisor:: Prof. [[John Smith]]\njury-role:: Examiner\nstart:: [[2020/01]]\nend:: [[2023/06]]',
    properties: {
      type: 'student',
      website: 'plourenco.eu',
      'thesis-type': 'PhD',
      degree: 'PhD',
      university: ['University of Minho'],
      supervisor: 'Prof. [[John Smith]]',
      'jury-role': 'Examiner',
      start: '[[2020/01]]',
      end: '[[2023/06]]',
    },
    children: [],
  },
];

// Standalone project pages
const PROJECT_BLOCKS = [
  {
    id: 80,
    content: 'My Cool Project\ntype:: project\nwebsite:: plourenco.eu\ninstitution:: [[University of Porto]]\ncategory:: Research\nstart:: [[2021/01]]\nend:: [[2022/12]]\ndescription:: A description',
    properties: {
      type: 'project',
      website: 'plourenco.eu',
      institution: ['University of Porto'],
      category: 'Research',
      start: '[[2021/01]]',
      end: '[[2022/12]]',
      description: 'A description',
    },
    children: [],
  },
];

// Publication Overrides
const PUB_OVERRIDE_BLOCKS = [
  {
    id: 90,
    content: 'type:: publication-override\ncite-key:: doe2021\nselected:: true\nabbr:: ICML',
    properties: {
      type: 'publication-override',
      'cite-key': 'doe2021',
      selected: 'true',
      abbr: 'ICML',
    },
    children: [],
  },
];

// Template block — should be skipped
const TEMPLATE_BLOCK = {
  id: 99,
  content: 'type:: experience\ntemplate:: experience-template',
  properties: {
    type: 'experience',
    template: 'experience-template',
  },
  children: [],
};

module.exports = {
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
  TEMPLATE_BLOCK,
};
