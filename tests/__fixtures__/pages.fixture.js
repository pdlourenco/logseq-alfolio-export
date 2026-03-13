// Represents output of logseq.Editor.getAllPages()

const PAGES_FIXTURE = [
  // Institution with abbreviation and icon
  {
    name: 'university of porto',
    originalName: 'University of Porto',
    properties: {
      abbreviation: 'UP',
      icon: 'up',
      alias: ['UPorto', 'UP'],
    },
  },
  // Another institution
  {
    name: 'university of minho',
    originalName: 'University of Minho',
    properties: {
      abbreviation: 'UMinho',
      icon: 'uminho',
    },
  },
  // A person with affiliation at University of Porto
  {
    name: 'paulo oliveira',
    originalName: 'Paulo Oliveira',
    properties: {
      type: ['person'],
      affiliation: ['University of Porto'],
    },
  },
  // A person with affiliation at University of Minho (external supervisor)
  {
    name: 'john smith',
    originalName: 'John Smith',
    properties: {
      type: ['person'],
      affiliation: ['University of Minho'],
    },
  },
  // Plain page
  {
    name: 'cv/experience',
    originalName: 'CV/Experience',
    properties: {},
  },
];

module.exports = { PAGES_FIXTURE };
