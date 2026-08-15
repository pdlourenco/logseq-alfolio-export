# CLAUDE.md — logseq-alfolio-export

A Logseq plugin that reads a personal knowledge graph and exports a **neutral intermediate YAML** describing a CV, students, projects, and personal-interest pages. A separate repo consumes that YAML and turns it into an al-folio Jekyll site.

## Scope boundary — enforce this

This plugin knows about **Logseq only**. It must not contain any al-folio, Jekyll, or RenderCV concepts. If you find yourself writing `_data/cv.yml` structure or Liquid-shaped output here, stop — that belongs in `github.com/pdlourenco/pdlourenco.github.io`.

The output is a **contract**. Treat it as a versioned API:
- `manifest.json` carries `plugin_version` and `exported_at`.
- Breaking the shape of `cv.yml` / `profile.yml` / `personal.yml` means bumping the version and telling the website repo.

## Companion repos

| Repo | Role |
|---|---|
| This repo | Logseq → intermediate YAML |
| `github.com/pdlourenco/pdlourenco.github.io` | intermediate YAML → al-folio site |

---

## Current state

Working v0.1.0 in vanilla JS, no build step. Files:

```
package.json    plugin manifest
index.html      entry point (loads @logseq/libs from CDN)
index.js        all logic (~850 lines)
icon.svg        toolbar icon
sync.sh         copies exported files into the Jekyll site
README.md       user-facing docs
```

**It has never been run against a real graph.** First task is empirical validation, not new features.

---

## The graph schema it reads

Four data locations:

1. **`CV/` namespace** — `CV/Profile`, `CV/Experience`, `CV/Education`, `CV/Awards`, `CV/Skills`, `CV/Languages`, `CV/Research Interests`. One page per section, one block per entry.
2. **`Personal/` namespace** — personal life wiki. Only pages carrying `website:: [[plourenco.eu]]` are exported (`Personal/Music`, `Personal/Cycling & Hiking`, `Personal/DIY`, `Personal/Reading`). Untagged pages (recipes, home-office ideas) stay private. **This opt-in tag is a privacy boundary — never export a `Personal/` page without it.**
3. **`plourenco.eu/` namespace** — `plourenco.eu/Publication Overrides`, `plourenco.eu/Blog Ideas`.
4. **Standalone pages** — students, projects, organizations, people. Exported when tagged `website:: [[plourenco.eu]]`.

### Property conventions

- Page refs wrapped: `type:: [[student]]`, `organization:: [[GMV]]`
- People with titles **outside** brackets: `supervisor:: Prof. [[Pedro Batista]]`
- Institutions comma-separated as individual refs: `university:: [[Instituto Superior Técnico]], [[Universidade de Lisboa]]`
- **Dates always in `[[]]`, always `YYYY/MM/DD`** with trailing components dropped: `[[2022]]`, `[[2022/07]]`, `[[2022/07/15]]`
- Profile links as markdown: `linkedin:: [pdlourenco](https://www.linkedin.com/in/pdlourenco)`

### Resolution the plugin performs

| Step | Rule |
|---|---|
| Alias expansion | `[[IST]]` → `Instituto Superior Técnico` via each page's `alias::` |
| Icon inheritance | Entry's `organization::`/`school::`/`university::` page supplies `icon::`. Personal projects carry their own `icon::` as fallback. |
| Supervisor affiliation | Look up supervisor's person page `affiliation::`; if it differs from the student's `university::` list, append the institution's `abbreviation::` → `Prof. Bruno J. Guerreiro (NOVA FCT)`. If it matches, omit. If no person page, name only. |
| Date conversion | `[[2022/07]]` → `2022-07` |
| Bracket stripping | All `[[]]` removed from exported values |

---

## Priority 1 — validate against a real graph

Nothing else matters until this is done. Run the export and check each assumption:

### Logseq property parsing quirks (the big risk)

Logseq does **not** hand plugins raw property strings consistently. Verify empirically for each property type:

- Does `type:: [[student]]` arrive as `"[[student]]"`, `"student"`, or `["student"]`?
- Does `university:: [[A]], [[B]]` arrive as a string or an array?
- Does `alias::` arrive as string or array? (It is special-cased by Logseq.)
- Are property keys kebab-case as written (`thesis-type`) or normalized?
- Do markdown-link values (`[label](url)`) survive intact?

`cleanProp()` / `rawProp()` in `index.js` already try to handle string-or-array, but the guesses are untested. **Write a debug command that dumps raw `block.properties` for one page of each type to the console, then fix the parsers against reality.**

### Block title extraction

`extractBlockTitle()` takes the first line that isn't a property line. Verify against:
- Entries whose title contains `::` (unlikely but possible)
- Entries whose first line is a `[[ref]]` (e.g. `- [[Rainy Days]]`)
- The `## Section` headers inside `Personal/*` pages

### Sandbox storage path

`README.md` claims files land at `<graph>/.logseq/plugins/storages/<plugin-id>/`. Other plugins report `<graph>/assets/storages/<plugin-id>/`. **`logseq.Assets.makeSandboxStorage()` is the API in use — find where it actually writes, then fix both `README.md` and `sync.sh`.** There is also a known Logseq bug (`BUG: should not join with empty dir`) when writing via storage APIs; check whether it fires.

Also verify: can `setItem()` create nested paths (`blog/2024-06-15-post.md`)? If not, flatten the key and let `sync.sh` fan out.

### Known data bugs to fix

- **`Hugo Pereira (PhD)`** — the second degree entry lives as a sibling block whose title carries a disambiguating suffix. Strip `(PhD)`/`(M.Sc.)` suffixes from exported names, or key entries by page rather than block title.
- **Gil Serrano's supervisors** — the source data had affiliations baked in (`[[Bruno J. Guerreiro (NOVA FCT)]]`). Graph must be cleaned to `[[Bruno J. Guerreiro]]` and person pages created. Add a **validation warning** when a `[[ref]]` contains parentheses, since that usually means an unresolvable page link.
- **Blog post bodies** — `runExport()` writes front matter only; there is a `// TODO: extract body from sub-bullets`. Implement Logseq-outline → markdown conversion (nested bullets → nested lists, `## headers` preserved, code blocks preserved).

---

## Priority 2 — robustness

### Validation pass

Add a pre-export lint that reports (without failing):
- `[[refs]]` that resolve to no page
- Entries missing required properties for their `type`
- Dates not matching `YYYY`, `YYYY/MM`, or `YYYY/MM/DD`
- Supervisors with no person page (so affiliation can't be resolved)
- Icons referenced but not present in the site's `icon_map.yml` (can't check from here — just report the set of icon keys used)

Surface as a summary in the success toast: `Exported 32 entries, 4 warnings — see console`.

### Determinism

Sort everything before writing. Logseq's page/block order is not guaranteed stable across re-indexes, and unstable ordering makes `git diff` in the website repo useless. Sort entries by a stable key (name, or start date then name).

### Dry-run mode

A command that runs the whole pipeline and logs the output without writing files.

---

## Priority 3 — the Logseq DB version problem

⚠️ **This is the largest medium-term risk to the project.**

Logseq is migrating from file-based graphs (markdown files + `:block/properties` maps) to a **DB-based** version where properties are first-class entities and the `Namespace/Page` convention is replaced by tags/properties. This breaks essentially every assumption in `index.js`.

Actions:
1. Set `unsupportedGraphType` in `package.json` to whichever type is genuinely unsupported, so Logseq refuses to load rather than silently misbehaving. Right now this field is absent — add it. **Verified:** it is a real optional field, values `file | db` ([Logseq Plugin Setup Guide](https://gist.github.com/xyhp915/bb9f67f5b430ac0da2629d586a3e4d69)); this plugin needs `db`.
2. Detect graph type at runtime and show a clear message if it's not the supported type. **Verified:** `logseq.App.checkCurrentIsDbGraph(): Promise<Boolean>` is the API for this ([IAppProxy](https://logseq.github.io/plugins/interfaces/IAppProxy.html)) — but `index.html` pins `@logseq/libs@0.0.17` from CDN, which predates it, so this needs the pin bumped first.
3. Isolate all graph-reading behind a small adapter layer (`readPages()`, `readBlocks()`, `readProperties()`) so a DB-version implementation can be swapped in without touching the transformers. **Do this refactor before adding features** — it is much cheaper now than later.
4. Keep the intermediate output format identical across graph types. That is the whole point of the contract.

Related: the `alias::` and namespace (`/`) conventions may not survive the migration. Note in the schema doc that the `CV/`, `Personal/`, `plourenco.eu/` namespaces may need to become tags.

---

## Priority 4 — quality of life

- **Auto-export on graph load** exists behind a setting, defaulted off. Once trusted, consider defaulting on.
- **`sync.sh` does not commit or push.** Consider an option that stages `_incoming/` in the site repo and opens a diff, so the human reviews before pushing.
- **One-way sync only.** Edits made directly to the site's YAML are silently overwritten on next export. Document this prominently; consider a checksum warning.
- **Assets.** Album art, DIY photos, and icons currently must be placed in the Jekyll repo by hand. Logseq stores its own assets under `assets/`. Consider exporting referenced images too, or explicitly documenting that assets are the site repo's responsibility (this is the simpler choice — prefer it unless there's a strong reason).
- **Tests.** A Vitest harness exists and runs in plain Node with no Logseq running: unit tests for the parsers and serializer, integration tests for the extractors, transformers and `runExport()`, property-based tests (`fast-check`, with `js-yaml` as a YAML oracle) for the round-trip law, and a shell test driving `sync.sh`. `fast-check` and `js-yaml` are devDependencies — the plugin runtime stays zero-dependency, and neither may be imported by `index.js`. CI runs `npm test` on every push and PR.
  The original point still stands where it matters: the committed fixtures are **hand-written guesses** at Logseq's API shapes, so the suite proves self-consistency, not conformance with reality. Capturing real `getAllPages()` / `getPageBlocksTree()` output and regenerating the fixtures from it is Priority 1 work (see ROADMAP.md, PR 3).

---

## Settings

| Key | Default | Purpose |
|---|---|---|
| `autoExportOnLoad` | `false` | Run export after `onGraphAfterIndexed` |
| `websiteName` | `plourenco.eu` | Value matched against `website::` to select pages |

The `websiteName` setting exists so the plugin generalizes to other people's graphs. Keep it that way — no hardcoded `plourenco.eu` anywhere in the logic (there are none left; don't reintroduce any).

---

## Development loop

1. Edit `index.js` (vanilla JS, no build).
2. Logseq → Plugin Manager → reload the plugin.
3. Trigger export (toolbar button or command palette).
4. Read the console. `console.log` liberally — it's the only debugger.

---

## If this were to be published

Currently a personal tool loaded unpacked in developer mode. To go to the marketplace it would need: a proper `id`, semantic-release, a demo GIF, and the `websiteName` setting to be genuinely generic (which it nearly is). Not a priority.
