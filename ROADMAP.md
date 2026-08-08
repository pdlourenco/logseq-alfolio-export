# ROADMAP.md — seed.md analysis and phased implementation plan

This document is the working agreement between the **author** (implements the phases below, one branch/PR per phase, branched from `main`) and the **reviewer** (reviews each PR against the acceptance criteria and the checklist at the bottom). It responds to `seed.md` — read that first.

---

## Critical analysis of seed.md

### Confirmed correct
- **Contract framing** (output YAML as a versioned API) is right, but the doc gives it no enforcement mechanism. PR 3 adds one (snapshot contract tests).
- **Priority ordering** — empirical validation before features — is right. The property-parsing quirks (string vs. array vs. bracket-stripped values) are the top risk; `cleanProp()`/`rawProp()` are untested guesses.
- **The `Personal/` opt-in privacy boundary** is testable and becomes a machine-checked invariant in PR 3.
- **DB-migration adapter prescription** is the right call at the right time.

### Stale or corrected
- **"No test harness exists" (Priority 4) is out of date.** A 173-test Vitest suite (unit + integration, mocked `logseq` global, hand-written fixtures) was merged in `387fc2f`. The doc's deeper point survives: those fixtures are *guesses* at Logseq's API shapes, so the suite proves self-consistency, not conformance with reality. PR 1 updates seed.md.
- **API facts, now verified** (previously flagged as uncertain in seed.md):
  - `unsupportedGraphType` is a real optional `package.json` field, values `file | db` — see the [Logseq Plugin Setup Guide](https://gist.github.com/xyhp915/bb9f67f5b430ac0da2629d586a3e4d69).
  - `logseq.App.checkCurrentIsDbGraph(): Promise<Boolean>` exists — see [IAppProxy](https://logseq.github.io/plugins/interfaces/IAppProxy.html). **Caveat:** `index.html` pins `@logseq/libs@0.0.17` from CDN, which predates this API; DB detection requires bumping the pin (PR 4).

### Gaps the doc misses
1. **`toYAML()` is a latent contract-corruption bug.** Code analysis found concrete escaping holes: a string with a leading `-` inside an array (`["- item"]`) serializes to `- - item`, which a real YAML parser reads as a *nested list*; leading `&`, `!`, `|`, `>`, `?`, `%` go unquoted; leading/trailing whitespace is silently lost. Property-based round-trip testing finds these mechanically (PR 1).
2. **No CI.** Added in PR 1.
3. **Priority 1 requires a human-in-the-loop bridge**: agent sessions cannot run Logseq. The bridge is a capture command (PR 3) run once by the repo owner against the real graph. It answers the property-quirk questions, the sandbox-path question, and feeds fixture realism in a single run.
4. **Adapter caveat**: keep the adapter a seam *inside* `index.js` (plain classes), not a module split. The no-build-step constraint is part of the plugin's design and must survive.

### Standing decisions (from the repo owner)
- Work lands as **phased PRs**, reviewed separately.
- **Fixture privacy**: the raw graph capture may contain the entire private graph — it stays local and gitignored, never committed. Committed fixtures are **synthetic**, derived by an agent to match the empirically observed shapes.

---

## Status: seed.md asks vs. what exists

| seed.md item | Status |
|---|---|
| Test harness (P4) | ✅ 173 tests merged — fixtures are unverified guesses |
| Empirical property-shape validation (P1) | ❌ PR 3 (capture) + one human run |
| Sandbox path verification (P1) | ❌ Same human run; then fix README/sync.sh |
| `(PhD)` suffix bug, paren-ref warning (P1) | ❌ PR 2 |
| Blog body extraction (P1) | ❌ PR 4 |
| Validation/lint pass (P2) | ❌ PR 2 |
| Determinism/sorting (P2) | ❌ PR 2 |
| Dry-run mode (P2) | ❌ PR 2 |
| Adapter layer (P3) | ❌ PR 3 |
| `unsupportedGraphType` + runtime DB detection (P3) | ❌ PR 4 (verified feasible; needs CDN bump) |
| Property-based ("Monte Carlo") tests | ❌ New — PR 1, PR 3 |
| Snapshot contract tests | ❌ New — PR 3 |
| CI | ❌ New — PR 1 |

---

## PR 1 — Property-based testing + the fixes it forces

Ordering rationale for the whole roadmap: property tests come first because they will expose `toYAML` bugs that later snapshot tests would otherwise freeze in as "golden".

- Add devDependencies only (runtime stays zero-dependency): `fast-check`, `js-yaml`. js-yaml is a **test oracle only** — it must never be imported by the plugin.
- `tests/property/toYAML.property.test.js`: round-trip law — for arbitrary JSON-ish objects, `jsyaml.load(toYAML(obj))` deep-equals `obj` modulo the documented null/undefined-key dropping.
- `tests/property/parsers.property.test.js`: fuzz the pure parsers on arbitrary strings — `stripBrackets` (idempotent, never throws), `extractRefs` (results contain no brackets), `convertDate`, `parsePeopleRefs`, `parseMarkdownLink`, `extractBlockTitle` (all total functions).
- Fix the `toYAML` escaping holes the round-trip exposes (expected at minimum: leading `-`, `&`, `!`, `|`, `>`, `?`, `%`; padded whitespace).
- Add `.github/workflows/test.yml` running `npm test` on push/PR. Property tests use a fixed fast-check seed in CI (reproducible), random seed locally.
- Update seed.md: tests exist; record the two verified API facts above.

**Acceptance:** the round-trip test demonstrably fails on the leading-`-` case *before* the fix (show it in the PR description), passes after; all 173 existing tests still pass; CI green.

## PR 2 — Determinism + validation pass + known data bugs

- Sort every exported collection by a stable key (start date, then name) before serialization. Property test: shuffling input page/block arrays yields byte-identical output files (permutation invariance).
- Pre-export lint (reports, never fails the export): unresolvable `[[refs]]`; refs containing parentheses (the Gil Serrano case from seed.md); entries missing required properties for their `type`; dates not matching `YYYY[/MM[/DD]]`; supervisors with no person page; the set of icon keys used. Summary in the success toast (`Exported N entries, M warnings — see console`).
- Strip `(PhD)` / `(M.Sc.)` disambiguation suffixes from exported names (the Hugo Pereira case) — with tests.
- Dry-run command: full pipeline, logs output, writes nothing.

**Acceptance:** each lint rule has a unit test with a failing input; permutation-invariance property test passes; suffix stripping tested; dry-run writes no files (assert `setItem` uncalled).

## PR 3 — Adapter seam + capture tooling + synthetic fixtures + snapshot contract tests

- **GraphReader seam inside `index.js`** (no module split): `readAllPages()`, `readPageBlocksTree(name)`, `query(dsl)`. `FileGraphReader` wraps `logseq.Editor.*` / `logseq.DB.*`; `FixtureGraphReader` loads a JSON dump. `ResolutionCache`, extractors, and `runExport` accept a reader. Migrate existing tests from `logseq.*` global mocks to `FixtureGraphReader` where that simplifies them.
- **Capture command** (new palette command): dumps raw `getAllPages()` plus block trees per page as JSON to sandbox storage. Output is gitignored and **never committed** (may contain the full private graph).
- **Human step — the only one in the roadmap**: repo owner runs capture on the real graph, and records (a) where `makeSandboxStorage()` actually writes, (b) whether nested keys (`blog/…`) work. Fix README + `sync.sh` accordingly.
- **Synthetic fixture regeneration**: from the local capture, rewrite `tests/__fixtures__/` as synthetic data matching the observed shapes (string vs. array properties, key casing, alias format). Only synthetic data is committed.
- **Snapshot contract tests**: full `cv.yml` / `profile.yml` / `personal.yml` / `manifest.json` generated from the synthetic fixture graph, as Vitest snapshots. A snapshot diff = intentional contract change = `plugin_version` bump + seed.md note. This enforces the "output is a contract" rule.
- **Privacy property test**: randomly generated graphs with mixed tagged/untagged `Personal/` pages — assert untagged `Personal/` content never reaches any output file, and `runExport` never throws.

**Acceptance:** snapshot suite runs offline with no `logseq` global on the fixture path; privacy property test present; no real names or private data in any committed file; capture output path in `.gitignore`.

## PR 4 — Blog bodies + DB-graph prep

- Outline→markdown converter (pure function): nested bullets → nested lists, `##` headers preserved, code blocks preserved, property lines excluded. Unit tests + properties (no `::` property lines in output; balanced code fences).
- DB prep: add `"unsupportedGraphType": "db"` to the `logseq` block of `package.json`; bump the `@logseq/libs` CDN pin in `index.html` (human verifies the plugin still loads); runtime guard via `checkCurrentIsDbGraph()` with a clear "file graphs only" message; note the namespace→tag migration risk in seed.md.
- A real DB-graph reader is explicitly **out of scope** — blocked on Logseq DB plugin-API maturity. The PR 3 adapter is its future insertion point.

**Acceptance:** converter handles a representative outline fixture; blog files in the export now include bodies; guard is a no-op on file graphs.

---

## Reviewer checklist (applied to every PR)

1. **Scope boundary**: zero al-folio / Jekyll / Liquid concepts in this repo.
2. **Privacy**: untagged-`Personal/` invariant tested; committed fixtures synthetic only; capture output gitignored; no real personal data in snapshots.
3. **Runtime purity**: plugin stays zero-dependency vanilla JS, browser-loadable, no build step; the `module.exports` seam pattern at the bottom of `index.js` preserved; new deps are devDependencies only.
4. **No hardcoded `plourenco.eu`** in logic (tests/fixtures may use it as a *setting value*).
5. **Determinism** (from PR 2 on): repeated runs are byte-identical.
6. **Contract discipline**: snapshot diffs must be intentional, with a `plugin_version` bump and a seed.md note.
7. **Test quality**: property tests reproducible (seed reported on failure); no tests asserting incidental formatting.
8. **seed.md stays truthful** — each PR updates it wherever it changes reality.

Disagreements resolve toward seed.md's stated constraints — contract, privacy, no build step — as the tiebreaker.
