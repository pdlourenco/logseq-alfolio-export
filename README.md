# logseq-alfolio-export

A Logseq plugin that exports your academic CV, projects, students, and personal page data to YAML files compatible with the [al-folio](https://github.com/alshedivat/al-folio) Jekyll theme.

## How it works

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────┐
│   Logseq Graph  │────▶│  Plugin      │────▶│  YAML files  │
│                 │     │  (this)      │     │  in sandbox  │
│  CV/ namespace  │     │              │     │              │
│  Personal/      │     │  Resolves:   │     │  cv.yml      │
│  Student pages  │     │  • aliases   │     │  profile.yml │
│  Project pages  │     │  • icons     │     │  personal.yml│
│  Org pages      │     │  • affils    │     │  pub_overr.. │
│  Person pages   │     │  • dates     │     │  manifest.json│
└─────────────────┘     └──────────────┘     └──────┬───────┘
                                                    │
                                              sync.sh │
                                                    ▼
                                             ┌──────────────┐
                                             │  Jekyll site │
                                             │  _data/*.yml │
                                             │  _posts/*.md │
                                             └──────────────┘
```

## Installation

1. Clone or download this folder into your Logseq graph's plugins directory
2. In Logseq, go to Settings → Advanced → Developer mode → ON
3. Open the Plugin Manager (⋯ menu → Plugins)
4. Click "Load unpacked plugin" and select this folder
5. The export button (↓ arrow) appears in the toolbar

## Usage

### Manual export

- Click the **↓** toolbar button, or
- Open Command Palette (`Ctrl+Shift+P`) → "Export to al-folio"

### Auto-export on graph load

1. Go to plugin settings (Plugin Manager → al-folio Export → ⚙)
2. Enable "Auto-export on graph load"
3. Every time you open Logseq, the export runs automatically after indexing

### Syncing to Jekyll site

After exporting, run the companion script to copy files to your Jekyll site:

```bash
# Using defaults (configure GRAPH_DIR and SITE_DIR in the script)
./sync.sh

# Or with explicit paths
./sync.sh --graph ~/logseq --site ~/pdlourenco.github.io
```

The sync script copies:
- `cv.yml` → `_data/cv.yml`
- `profile.yml` → `_data/profile.yml`
- `personal.yml` → `_data/personal.yml`
- `publication_overrides.yml` → `_data/publication_overrides.yml`
- `blog/*.md` → `_posts/*.md`

## What gets exported

### CV page (`cv.yml`)

Pulled from the **CV/ namespace** pages:

| Logseq page | YAML section |
|---|---|
| CV/Experience | `experience` |
| CV/Education | `education` |
| CV/Awards | `awards` |
| CV/Skills | `skills` |
| CV/Languages | `languages` |
| CV/Research Interests | `research_interests` |

Plus from **standalone pages** tagged `website:: [[plourenco.eu]]`:

| Page type | YAML section |
|---|---|
| `type:: [[project]]` | `projects` |
| `type:: [[student]]` (supervisor) | `teaching.supervised_students` |
| `type:: [[student]]` (jury) | `teaching.jury` |

### Profile (`profile.yml`)

From **CV/Profile** — name, email, social links, bio.

### Personal page (`personal.yml`)

From **Personal/ namespace** pages tagged `website:: [[plourenco.eu]]`:
- Personal/Music → music section (discography, instruments, embeds)
- Personal/Cycling & Hiking → cycling section (Wikiloc, featured trips)
- Personal/DIY → DIY section (tools, interests, projects)
- Personal/Reading → reading section (Goodreads link)

### Publication overrides (`publication_overrides.yml`)

From **plourenco.eu/Publication Overrides** — `selected`, `abbr`, `preview` per cite-key.

### Blog posts (`blog/*.md`)

From **plourenco.eu/Blog Ideas** — only entries with `status:: published`.

## Resolution logic

The plugin resolves data at export time:

### Alias resolution
`[[IST]]` → `Instituto Superior Técnico` (expands aliases to canonical page names)

### Icon inheritance
Experience/education/student entries inherit their icon from the organization page's `icon::` property.

### Supervisor affiliations
For each supervisor on a student page:
1. Look up the person's `affiliation::` page
2. Compare against the student's `university::` list
3. If different → append abbreviation: `Prof. Bruno J. Guerreiro (NOVA FCT)`
4. If same → omit affiliation

### Date conversion
`[[2022/07]]` → `2022-07` (Logseq format → YAML/Jekyll format)

## Settings

| Setting | Default | Description |
|---|---|---|
| Auto-export on graph load | `false` | Run export automatically when Logseq opens |
| Website page name | `plourenco.eu` | The `website::` value to filter pages for export |

## File structure

```
logseq-alfolio-export/
├── package.json    # Plugin metadata
├── index.html      # Entry point
├── index.js        # Plugin logic (all-in-one)
├── icon.svg        # Toolbar icon
├── sync.sh         # Companion: copy exports to Jekyll site
└── README.md       # This file
```

## Output location

Exported files are written to the plugin's sandbox storage:

```
<graph>/.logseq/plugins/storages/logseq-alfolio-export/_logseq_export/
├── cv.yml
├── profile.yml
├── personal.yml
├── publication_overrides.yml
├── manifest.json
└── blog/
    └── 2024-06-15-gnc-simulation-pipeline.md
```

## Development

This is a vanilla JS plugin (no build step required). Edit `index.js` directly and reload the plugin in Logseq (Plugin Manager → al-folio Export → reload icon).

To add new entity types:
1. Add a transformer function (`transformXxx`)
2. Add extraction in `runExport()`
3. Add the data to the appropriate YAML output
4. Update `sync.sh` if the file goes to a new location

## License

MIT
