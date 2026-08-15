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
                                             ┌──────────────┐     ┌──────────────┐
                                             │  Site repo   │────▶│  Jekyll site │
                                             │  _incoming/  │     │  _data/*.yml │
                                             │  (verbatim)  │     │  _posts/*.md │
                                             └──────────────┘     └──────────────┘
                                                            transform.py
                                                          (in the site repo)
```

This plugin's output is an **intermediate format**, not al-folio's format. It
lands in the site repo's `_incoming/` directory exactly as exported; the site's
own `bin/transform.py` is the only thing that writes `_data/`, `_posts/`, and
`_bibliography/`. See the [contract v1
schemas](https://github.com/pdlourenco/pdlourenco.github.io/tree/master/docs/intermediate-schema)
for the normative shape of each file.

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

### Dry run

Command Palette → **"Export to al-folio (dry run — writes nothing)"** runs the
whole pipeline and logs every file it would write, touching nothing on disk.
Useful for checking what a graph change does to the output before committing to it.

### Capturing graph shapes (plugin development)

Command Palette → **"Capture graph shapes (for plugin development)"** dumps what
Logseq actually hands the plugin, so the parsers can be checked against reality
rather than against assumptions. It writes two files to plugin storage:

| File | Contents | Sharing |
|---|---|---|
| `_logseq_capture/dump.json` | Raw `getAllPages()` / `getPageBlocksTree()` output — **your entire graph**, including untagged `Personal/` pages the export never touches | **Never commit or paste this.** It stays on your machine |
| `_logseq_capture/shapes.json` | Property key names, the JS type each arrives as, and *redacted* value shapes — every letter becomes `a`, every digit `9` | Safe to share |

A redacted shape keeps the structure and drops the content:

```
"Prof. [[Pedro Batista]]"  →  "aaaa. [[aaaaa aaaaaaa]]"
"[[2022/07/15]]"           →  "[[9999/99/99]]"
"[label](https://x.com)"   →  "[aaaaa](aaaaa://a.aaa)"
```

which is enough to answer whether `type::` arrives as a string or an array,
whether keys keep their kebab-case, and whether markdown links survive — without
revealing a single name.

The capture also probes whether nested storage keys (`blog/post.md`) round-trip,
and prints where to find the files, which answers where the sandbox actually
writes.

### Validation warnings

Every export lints the graph first and reports, without ever failing the export:

| Warning | Meaning |
|---|---|
| `unresolved-ref` | A `[[ref]]` matches no page |
| `ref-parentheses` | A ref like `[[Name (AFFIL)]]` — usually an affiliation baked into a link, which cannot resolve |
| `bad-date` | A date that is not `YYYY`, `YYYY/MM` or `YYYY/MM/DD` |
| `missing-property` | An entry lacks a property its `type::` needs |
| `unknown-supervisor` | A supervisor has no person page, so affiliation cannot be resolved |
| `icons-used` | Inventory of icon keys the site must map in `icon_map.yml` |

The toast summarises (`32 entries, 6 files, 4 warnings — see console`); the detail
goes to the console.

### Auto-export on graph load

1. Go to plugin settings (Plugin Manager → al-folio Export → ⚙)
2. Enable "Auto-export on graph load"
3. Every time you open Logseq, the export runs automatically after indexing

### Syncing to Jekyll site

After exporting, run the companion script to copy files to your Jekyll site:

```bash
./sync.sh --site ~/pdlourenco.github.io

# --graph defaults to $GRAPH_DIR or ~/logseq
./sync.sh --graph ~/logseq --site ~/pdlourenco.github.io
```

`--site` is required and has no default, so a stray `./sync.sh` cannot reach a
real site checkout by accident.

The sync script copies into `_incoming/` and nowhere else. It copies **exactly
what the export's `manifest.json` lists** — `cv.yml`, `profile.yml`,
`personal.yml`, `publication_overrides.yml`, `blog/*.md`, and the manifest
itself — rather than globbing, so a file left over from an earlier run in the
plugin's storage is never staged.

It also **prunes**: files the *previous* manifest listed that this export no
longer writes are deleted, so a blog post removed from your graph does not
linger in `_incoming/`. Pruning is deliberately conservative:

- It never clears the directory. `_incoming/` also holds files the plugin does
  not own — the site's own `README.md`, and `papers.src.bib` staged by hand.
  Only paths a previous export actually listed are ever removed.
- If the previous manifest is missing, unparseable, or of an unknown
  `schema_version`, nothing is pruned and the script says so.
- `manifest.json` is written **last**. It is the commit point: if a sync fails
  partway, the previous manifest survives and re-running is still correct.

Requires `python3` (to read the manifest safely).

Then review the diff in `_incoming/`, commit it, and run the site's transform to
regenerate `_data/` and `_posts/`. **Nothing here writes those directories** —
they are generated files, and overwriting them with intermediate-format YAML
makes the CV page render blank with no error.

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

`manifest.json` describes the export for the consuming site:

| Field | Purpose |
|---|---|
| `schema_version` | Intermediate-format contract version (currently `1`). The site refuses a version it does not know rather than guessing. |
| `exported_at` | ISO 8601 timestamp. Informational. |
| `plugin_version` | Read from `package.json`, so it cannot disagree with what shipped. Omitted with a warning if unreadable. |
| `website` | The site tag pages were filtered on. |
| `files` | Every file in the export, including `manifest.json` and blog posts. |
| `hashes` | SHA-256 per file, excluding `manifest.json` itself — detects a truncated or half-finished copy. Omitted with a warning if WebCrypto is unavailable. |
| `counts` | Per-section entry counts, as a sanity check. |

## Development

This is a vanilla JS plugin (no build step required). Edit `index.js` directly and reload the plugin in Logseq (Plugin Manager → al-folio Export → reload icon).

To add new entity types:
1. Add a transformer function (`transformXxx`)
2. Add extraction in `runExport()`
3. Add the data to the appropriate YAML output
4. Add the file to `sync.sh`'s copy list if it is a new file

Changing the *shape* of an existing output file is a contract change — see
`ROADMAP.md` for the versioning discipline that applies.

Run the tests with `npm test`.

## License

MIT
