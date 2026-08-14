# ROADMAP.md — seed.md analysis and phased implementation plan

This document is the working agreement between the **author** (implements the phases below, one branch/PR per phase, branched from `main`) and the **reviewer** (reviews each PR against the acceptance criteria and the checklist at the bottom). It responds to `seed.md` — read that first — and to [issue #1](https://github.com/pdlourenco/logseq-alfolio-export/issues/1), which established **intermediate-format contract v1**: the site repo has committed normative JSON Schemas under [`docs/intermediate-schema/`](https://github.com/pdlourenco/pdlourenco.github.io/tree/master/docs/intermediate-schema), derived from this plugin's actual output, with five conformance gaps filed against current behavior.

Roles are fixed from here on: the authoring session implements every phase (including PR 0, which it offered to take immediately); the reviewing session only reviews.

---

## Critical analysis of seed.md

### Confirmed correct
- **Contract framing** (output YAML as a versioned API) is right — and is now concrete: contract v1 exists as JSON Schemas in the site repo. Enforcement lands in PR 2.5 (manifest conformance) and PR 3 (snapshot tests).
- **Priority ordering** — empirical validation before features — is right. The property-parsing quirks (string vs. array vs. bracket-stripped values) are the top risk; `cleanProp()`/`rawProp()` are untested guesses.
- **The `Personal/` opt-in privacy boundary** is testable and becomes a machine-checked invariant in PR 3.
- **DB-migration adapter prescription** is the right call at the right time.

### Stale or corrected
- **"No test harness exists" (Priority 4) is out of date.** A 173-test Vitest suite (unit + integration, mocked `logseq` global, hand-written fixtures) was merged in `387fc2f`. The doc's deeper point survives: those fixtures are *guesses* at Logseq's API shapes, so the suite proves self-consistency, not conformance with reality. PR 1 updates seed.md.
- **"No hardcoded `plourenco.eu` — there are none left" is false.** `index.js:684-685` hardcodes `plourenco.eu/Publication Overrides` and `plourenco.eu/Blog Ideas` (on another user's graph those extractions silently return nothing), and `|| "plourenco.eu"` fallbacks at `index.js:320`, `:652`, `:734` mask an unset setting instead of surfacing it. Scheduled in PR 2; seed.md corrected there too.
- **API facts, now verified** (previously flagged as uncertain in seed.md):
  - `unsupportedGraphType` is a real optional `package.json` field, values `file | db` — see the [Logseq Plugin Setup Guide](https://gist.github.com/xyhp915/bb9f67f5b430ac0da2629d586a3e4d69).
  - `logseq.App.checkCurrentIsDbGraph(): Promise<Boolean>` exists — see [IAppProxy](https://logseq.github.io/plugins/interfaces/IAppProxy.html). **Caveat:** `index.html` pins `@logseq/libs@0.0.17` from CDN, which predates this API; DB detection requires bumping the pin (PR 4).

### Gaps the doc misses
1. **`toYAML()` is a latent contract-corruption bug — in two distinct classes, one of which emits unparseable YAML.** Property-based round-trip testing finds both mechanically (PR 1).

   **(a) Quoting holes — silent corruption.** The quoting predicate at `index.js:18-22` misses several indicators: `toYAML(['- item'])` emits `- - item`, which a real parser reads back as `[['item']]` — a nested list; leading `&`, `!`, `|`, `>`, `?`, `%` go unquoted; leading/trailing whitespace is lost to the `.trim()` calls at `:34`, `:40`, `:45`, `:60`.

   **(b) Structural holes — *invalid* YAML.** Two paths serialize nested collections without propagating indentation, so the output does not parse at all:
   - `index.js:45` (`pad + "- " + toYAML(item).trim()`) discards the indent for any non-plain-object list item. `toYAML([[1,2]])` → `- - 1\n- 2`, which parses as `[[1], 2]`; `toYAML({a:[[1,2]]})` → **parse error** (`end of the stream or a document separator is expected`).
   - `index.js:34` (`pad + "- " + firstKey + ": " + toYAML(firstVal).trim()`) inlines the **first** key's value even when it is an object or array, while the later-keys branch at `:37-38` handles it correctly. So key order alone decides validity:

     ```js
     toYAML([{ name: 'Skills', items: ['a'] }])  // → "- name: Skills\n  items:\n    - a"   ✅ parses
     toYAML([{ items: ['a'], name: 'Skills' }])  // → "- items: - a\n  name: Skills"        ❌ parse error
     toYAML([{ a: { b: 1 } }])                   // → "- a: b: 1"                            ❌ parse error
     ```

   **Reachability:** latent today, but guarded by nothing more than object-literal key order. Every transformer happens to put a scalar first (`position` `:346`, `degree` `:368`, `title` `:390`, `name` `:404`/`:416`/`:429`/`:499`), and `transformEducation`'s array-valued `university` (`:371`) sits at key 3, on the safe path. Reordering any one of those literals — an edit no reviewer would flag — turns a working export into a file the site's transform cannot read. That is the argument for fixing the serializer before snapshotting anything, restated at full strength.
2. **`sync.sh` writes to the wrong destination — the highest-severity item in the repo.** The site's pipeline is `plugin → _incoming/ → bin/transform.py → _data/`, with `transform.py` as the only writer of al-folio formats. Run today, `sync.sh` overwrites `_data/cv.yml` with intermediate-format YAML — al-folio reads `site.data.cv.cv`, a wrapper the intermediate file doesn't have, so the CV page renders blank with no error. It also writes `_posts/` directly and dirties files the site's CI verifies with `--check`. This is a data-loss guard, not a feature: **PR 0, first, regardless of everything else.**
3. **The manifest doesn't conform to contract v1** (issue #1): no `schema_version` (the site's transform treats a *missing* version as a hard error); `files` computed before `manifest.json` and blog posts are added, so it lists four entries while five or more are written (the transform cross-checks that list against disk in both directions); `plugin_version` hardcoded as `"0.1.0"`; no content hashes. Snapshot-testing this shape in PR 3 would enshrine an export the consumer rejects — the roadmap's own "don't freeze bugs as golden" argument, applied where it matters most. **PR 2.5**, after PR 2, before PR 3.
4. **No CI.** Added in PR 1.
5. **Priority 1 requires a human-in-the-loop bridge**: agent sessions cannot run Logseq. The bridge is a capture command (PR 3) run once by the repo owner against the real graph. It answers the property-quirk questions, the sandbox-path question, and feeds fixture realism in a single run.
6. **Adapter caveat**: keep the adapter a seam *inside* `index.js` (plain classes), not a module split. The no-build-step constraint is part of the plugin's design and must survive.

### Standing decisions (from the repo owner)
- Work lands as **phased PRs**, reviewed separately.
- **Fixture privacy**: the raw graph capture may contain the entire private graph — it stays local and gitignored, never committed. Committed fixtures are **synthetic**, derived by an agent to match the empirically observed shapes.
- **Null handling is contractual and must not be unified.** Current behavior: nulls are dropped inside mappings (`toYAML({a:null,b:1})` → `b: 1`) but emitted inside list items (`toYAML([{a:1,b:null}])` → `- a: 1\n  b: null`). Contract v1 accommodates both spellings and the site's transform treats them identically; making this uniform is a breaking shape change requiring a `schema_version` bump. PR 1 pins both behaviors with regression tests.

---

## Status: seed.md + contract v1 vs. what exists

| Item | Source | Status |
|---|---|---|
| Test harness (P4) | seed.md | ✅ 173 tests merged — fixtures are unverified guesses |
| `sync.sh` must target `_incoming/` only | contract v1 (#1, gap 1) | ❌ **PR 0** — live data-loss hazard |
| `manifest.json` `schema_version` | contract v1 (#1, gap 2) | ❌ PR 2.5 |
| `manifest.json` content hashes | contract v1 (#1, gap 3) | ❌ PR 2.5 — hard dependency on PR 2 sorting |
| `files` list completeness | contract v1 (#1, gap 4) | ❌ PR 2.5 |
| `plugin_version` from `package.json` | contract v1 (#1, gap 5) | ❌ PR 2.5 |
| Empirical property-shape validation (P1) | seed.md | ❌ PR 3 (capture) + one human run |
| Sandbox path verification (P1) | seed.md | ❌ Same human run; then fix README/sync.sh source path |
| `(PhD)` suffix bug, paren-ref warning (P1) | seed.md | ❌ PR 2 |
| Blog body extraction (P1) | seed.md | ❌ PR 4 |
| Validation/lint pass (P2) | seed.md | ❌ PR 2 |
| Determinism/sorting (P2) | seed.md | ❌ PR 2 |
| Dry-run mode (P2) | seed.md | ❌ PR 2 |
| Hardcoded site-name remediation | review finding | ❌ PR 2 |
| Adapter layer (P3) | seed.md | ❌ PR 3 |
| `unsupportedGraphType` + runtime DB detection (P3) | seed.md | ❌ PR 4 (verified feasible; needs CDN bump) |
| `toYAML` quoting holes (silent corruption) | review finding | ❌ PR 1 |
| `toYAML` structural holes (unparseable output) | review finding | ❌ PR 1 — latent, guarded only by key order |
| Property-based ("Monte Carlo") tests | new | ❌ PR 1, PR 3 |
| Snapshot contract tests | new | ❌ PR 3 |
| CI | new | ❌ PR 1 |

---

## PR 0 — `sync.sh` destination fix (data-loss guard, do first)

No dependency on any other phase. Note that it is **not** covered by the existing harness: the 173 tests are Vitest over `index.js`, `sync.sh` has zero test coverage, and the repo has no shell-test tooling. So state the verification method in the PR — either a recorded manual run against two throwaway directories (asserting `_data/`, `_posts/`, `_bibliography/` are untouched and `_incoming/` is populated), or a minimal shell test invoked from `npm test`. Do not describe this phase as covered by the suite when it isn't.

- `sync.sh` copies **exclusively** to `<site>/_incoming/`, leaving `_data/`, `_posts/`, and `_bibliography/` untouched.
- Drop the `SITE_DIR` default that points at the site repo — it makes the destructive behavior easy to trigger by accident.
- Fix `README.md`: lines 18-30 (pipeline diagram) and 58-70 (sync section) document the same wrong destination; the script fix alone would leave wrong user-facing instructions.

**Acceptance:** `sync.sh` writes only under `_incoming/`; no default that resolves to a real site checkout; README pipeline description matches `plugin → _incoming/ → transform.py → _data/`.

## PR 1 — Property-based testing + the fixes it forces

Ordering rationale for the whole roadmap: property tests come before snapshots because they expose `toYAML` bugs that snapshot tests would otherwise freeze in as "golden" (and, per PR 2.5, the same argument covers the manifest).

- Add devDependencies only (runtime stays zero-dependency): `fast-check`, `js-yaml`. js-yaml is a **test oracle only** — it must never be imported by the plugin.
- `tests/property/toYAML.property.test.js`: round-trip law — for arbitrary JSON-ish objects, `jsyaml.load(toYAML(obj))` deep-equals `obj` **modulo the exact current null spellings: null-valued keys are dropped in mappings but emitted as explicit `null` in list items**. Both behaviors are contractual (see Standing decisions); the law must encode them precisely, not "all nulls drop."
- Explicit regression tests pinning both null behaviors (`{a:null,b:1}` → `b: 1`; `[{a:1,b:null}]` → `- a: 1\n  b: null`), so a later tidy-up can't silently break the consumer.
- `tests/property/parsers.property.test.js`: fuzz the pure parsers on arbitrary strings — `stripBrackets` (idempotent, never throws), `extractRefs` (results contain no brackets), `convertDate`, `parsePeopleRefs`, `parseMarkdownLink`, `extractBlockTitle` (all total functions).
- Fix the `toYAML` holes the round-trip exposes — **without changing the null spellings**. Both classes from gap 1 are in scope:
  - *Quoting* (verified): leading `-` in list items, leading `&`, `!`, `|`, `>`, `?`, `%`, padded whitespace.
  - *Structural* (verified): propagate the indent through `index.js:45` instead of `.trim()`-ing it away, and route the first-key path at `:34` through the same object/array branch the later keys already use at `:37-38`. Add explicit regression tests for the three cases in gap 1, including a nested array under a mapping key.
- Add `.github/workflows/test.yml` running `npm test` on push/PR. Property tests use a fixed fast-check seed in CI (reproducible), random seed locally.
- Update seed.md: tests exist; record the two verified API facts above. (The "no hardcoded names" correction happens in PR 2 alongside the fix.)

**Acceptance:** the round-trip test demonstrably fails *before* the fix on both the leading-`-` case and at least one structural case that raises a parse error (show both in the PR description), and passes after; null-spelling regression tests pass before *and* after the fixes; CI green.

On the existing suite: these fixes intentionally change emitted bytes, so "all 173 tests still pass" is the wrong bar — any existing assertion that pins a now-corrected string *should* fail, and the total count will move once the new tests land. The bar instead: every existing test that changes is listed in the PR description with a one-line justification tying it to a specific fix above, and no existing test is deleted or weakened to make the suite green. A test that changes for any other reason is a review stop.

## PR 2 — Determinism + validation pass + known data bugs + hardcoded names

- Sort every exported collection by a stable key (start date, then name) before serialization. Property test: shuffling input page/block arrays yields byte-identical output files (permutation invariance). **This is a prerequisite for PR 2.5's hashes** — hashes over unsorted output would change on every Logseq re-index, and changed hashes read as changed content.
- Pre-export lint (reports, never fails the export): unresolvable `[[refs]]`; refs containing parentheses (the Gil Serrano case from seed.md); entries missing required properties for their `type`; dates not matching `YYYY[/MM[/DD]]`; supervisors with no person page; the set of icon keys used. Summary in the success toast (`Exported N entries, M warnings — see console`).
- Strip `(PhD)` / `(M.Sc.)` disambiguation suffixes from exported names (the Hugo Pereira case) — with tests.
- Remove hardcoded site names: derive the `Publication Overrides` and `Blog Ideas` page names at `index.js:684-685` from the `websiteName` setting; replace the `|| "plourenco.eu"` fallbacks at `:320`, `:652`, `:734` with a single settings-read that lints/warns when unset instead of silently defaulting. Correct seed.md's "there are none left" assertion.
- Dry-run command: full pipeline, logs output, writes nothing.

**Acceptance:** each lint rule has a unit test with a failing input; permutation-invariance property test passes; suffix stripping tested; dry-run writes no files (assert `setItem` uncalled); a test with `websiteName` set to a non-default value exercises the Publication Overrides/Blog Ideas paths.

## PR 2.5 — Manifest conformance to contract v1 (after PR 2, before PR 3)

Closes issue #1 gaps 2–5. Must land before PR 3 so snapshots freeze a manifest the site's transform accepts — today it treats a missing `schema_version` as a hard error (the site repo keeps a `legacy-unversioned` fixture specifically to test that rejection path).

- Add `"schema_version": 1` to `manifest.json`.
- Move the manifest/`files` computation **after** the blog loop, and include `manifest.json` itself per the contract's cross-check rules, so `files` matches what's written to disk in both directions.
- `plugin_version` read from `package.json` instead of the hardcoded `"0.1.0"`. Note: with no build step and `index.html` loading from CDN, this needs a runtime `fetch('./package.json')` (or documented duplication if fetch proves unavailable in the sandbox). This **breaks `tests/integration/runExport.test.js:84`**, which asserts `'0.1.0'` literally — updating that test is part of this PR.
- Add `"hashes": { "<file>": "<lowercase hex sha256>", ... }` for **every exported file except `manifest.json` itself** — a manifest cannot contain its own hash, and issue #1's example omits it. Note the asymmetry with the previous bullet: `files` includes `manifest.json`, `hashes` does not. Depends on PR 2's sorting being merged (see above).
- **Decide what happens to stale files in `_incoming/`** (raised in the PR 0 review). `sync.sh` copies but never removes, so an entry dropped from the graph — a blog post, say — persists in the destination after the export stops listing it. Harmless today only because `files` is incomplete anyway; the moment this PR makes `files` authoritative, a leftover file is exactly the condition the transform's both-directions cross-check fails on. Either `sync.sh` clears `_incoming/` before copying, or the transform tolerates extras. Make it a deliberate call here rather than discovering it when the cross-check starts failing.
- **Verify sha256 is reachable in the sandbox before committing to it.** With no build step and a zero-dependency runtime, the only implementation is `crypto.subtle.digest('SHA-256', …)`, which is async and exposed only in secure contexts. If the plugin iframe turns out not to qualify, say so in the PR and fall back to a documented alternative rather than vendoring a hash implementation — same hedge as the `fetch('./package.json')` bullet above.

**Acceptance:** manifest validates against the site repo's [`docs/intermediate-schema/`](https://github.com/pdlourenco/pdlourenco.github.io/tree/master/docs/intermediate-schema) manifest schema; `files` equals the set of written files including `manifest.json` and blog posts; `hashes` covers exactly that set minus `manifest.json`; hashes recomputed over the written bytes match; `runExport.test.js` updated; repeat runs on identical input produce identical hashes.

## PR 3 — Adapter seam + capture tooling + synthetic fixtures + snapshot contract tests

- **GraphReader seam inside `index.js`** (no module split): `readAllPages()`, `readPageBlocksTree(name)`, `query(dsl)`. `FileGraphReader` wraps `logseq.Editor.*` / `logseq.DB.*`; `FixtureGraphReader` loads a JSON dump. `ResolutionCache`, extractors, and `runExport` accept a reader. Migrate existing tests from `logseq.*` global mocks to `FixtureGraphReader` where that simplifies them.
- **Capture command** (new palette command): dumps raw `getAllPages()` plus block trees per page as JSON to sandbox storage. Output is gitignored and **never committed** (may contain the full private graph).
- **Human step — the only one in the roadmap**: repo owner runs capture on the real graph, and records (a) where `makeSandboxStorage()` actually writes, (b) whether nested keys (`blog/…`) work. Fix README + `sync.sh` *source* path accordingly (the destination was fixed in PR 0).
- **Synthetic fixture regeneration**: from the local capture, rewrite `tests/__fixtures__/` as synthetic data matching the observed shapes (string vs. array properties, key casing, alias format). Only synthetic data is committed.
- **Snapshot contract tests**: full `cv.yml` / `profile.yml` / `personal.yml` / `manifest.json` generated from the synthetic fixture graph, as Vitest snapshots — taken only now, after PR 1 (serializer fixed) and PR 2.5 (manifest conforms). A snapshot diff = intentional contract change = `schema_version` discussion + seed.md note.
- **Privacy property test**: randomly generated graphs with mixed tagged/untagged `Personal/` pages — assert untagged `Personal/` content never reaches any output file, and `runExport` never throws.

**Acceptance:** snapshot suite runs offline with no `logseq` global on the fixture path; snapshotted outputs validate against the contract v1 schemas; privacy property test present; no real names or private data in any committed file; capture output path in `.gitignore`.

## PR 4 — Blog bodies + DB-graph prep

- Outline→markdown converter (pure function): nested bullets → nested lists, `##` headers preserved, code blocks preserved, property lines excluded. Unit tests + properties (no `::` property lines in output; balanced code fences).
- DB prep: add `"unsupportedGraphType": "db"` to the `logseq` block of `package.json`; bump the `@logseq/libs` CDN pin in `index.html` (human verifies the plugin still loads); runtime guard via `checkCurrentIsDbGraph()` with a clear "file graphs only" message; note the namespace→tag migration risk in seed.md.
- A real DB-graph reader is explicitly **out of scope** — blocked on Logseq DB plugin-API maturity. The PR 3 adapter is its future insertion point.

**Acceptance:** converter handles a representative outline fixture; blog files in the export now include bodies; guard is a no-op on file graphs; snapshot diffs from added blog bodies are intentional and accompanied by the contract-discipline steps below.

---

## Reviewer checklist (applied to every PR)

1. **Scope boundary**: zero al-folio / Jekyll / Liquid concepts in this repo.
2. **Privacy**: untagged-`Personal/` invariant tested; committed fixtures synthetic only; capture output gitignored; no real personal data in snapshots.
3. **Runtime purity**: plugin stays zero-dependency vanilla JS, browser-loadable, no build step; the `module.exports` seam pattern at the bottom of `index.js` preserved; new deps are devDependencies only.
4. **No hardcoded `plourenco.eu`** in logic (tests/fixtures may use it as a *setting value*). Note: a per-PR checklist only catches *new* violations — the existing ones are scheduled work in PR 2.
5. **Determinism** (from PR 2 on): repeated runs are byte-identical — **for every file except `manifest.json`**, which embeds `exported_at: new Date().toISOString()` (`index.js:732`) and therefore cannot be. The determinism property test must exclude it, or PR 2 must make the timestamp injectable so tests can pin it; either is fine, but the criterion as stated is unsatisfiable without one of them. This does not weaken PR 2.5: the hashes are taken over the *other* files, which are fully deterministic.
6. **Contract discipline**: output-shape changes must be intentional, validate against the contract v1 schemas, and carry a `schema_version` decision plus a seed.md note. Null spellings (mapping-drop / list-emit) must never change without a version bump. Distinguish *serialization* from *shape*: PR 1's quoting and indentation fixes change emitted bytes while leaving the parsed structure identical (or, in the structural cases, making it parseable at all) — those are not shape changes and need no version bump. The test is what a YAML parser yields, not what the file looks like.
7. **Test quality**: property tests reproducible (seed reported on failure); no tests asserting incidental formatting.
8. **seed.md stays truthful** — each PR updates it wherever it changes reality.

Disagreements resolve toward the contract v1 schemas and seed.md's stated constraints — contract, privacy, no build step — as the tiebreaker.
