#!/usr/bin/env node
//
// Write a sample export to a directory, for the cross-repo CI job (#10).
//
// The contract between this plugin and the site is verified today by a human
// reading the other repo and reporting back, which has been wrong four times in
// ways that were true when checked and stale when used. This script is the
// producer half of fixing that: it turns the committed synthetic graph into a
// real export directory that the site's own transform can be run against.
//
//   node scripts/build-sample-export.js <out-dir>
//
// The sample is synthetic by standing decision: the real graph capture is
// private and never committed, so CI can never depend on it.

const fs = require('node:fs');
const path = require('node:path');

const { runExport, FixtureGraphReader } = require('../index.js');
const { buildSyntheticGraph } = require('../tests/__fixtures__/syntheticGraph.js');

// Pinned, not "now". manifest.json carries exported_at, so an unpinned clock
// makes two runs of the same input differ and the idempotency assertion fails
// on a difference that is not a determinism break — which is the fastest way to
// teach everyone to ignore the job (#10).
const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');
const SITE = 'plourenco.eu';

/** The plugin expects a `logseq` global; the export itself reads the graph through the reader. */
function installMinimalHost() {
  globalThis.logseq = {
    settings: { websiteName: SITE, autoExportOnLoad: false },
    // Nothing is written: the export returns its files and this script writes
    // them, so the sandbox is never touched.
    Assets: { makeSandboxStorage: () => ({ setItem: async () => {}, getItem: async () => null }) },
    UI: { showMsg: () => {} },
    Editor: {
      getAllPages: async () => { throw new Error('the sample must come from the fixture reader'); },
      getPageBlocksTree: async () => { throw new Error('the sample must come from the fixture reader'); },
    },
    DB: { datascriptQuery: async () => [] },
  };

  // index.js reads its version from package.json at runtime; there is no HTTP
  // server here, so serve the real file.
  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('package.json')) {
      return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(pkgPath, 'utf8')) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

async function buildSampleExport(outDir) {
  installMinimalHost();

  const reader = new FixtureGraphReader(buildSyntheticGraph({ site: SITE }));
  const { files, warnings } = await runExport({ reader, now: FIXED_NOW, dryRun: true });

  fs.rmSync(outDir, { recursive: true, force: true });
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(outDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  return { files, warnings };
}

module.exports = { buildSampleExport, FIXED_NOW, SITE };

if (require.main === module) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('usage: node scripts/build-sample-export.js <out-dir>');
    process.exit(2);
  }
  const silenced = console.log;
  const silencedWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  buildSampleExport(path.resolve(outDir))
    .then(({ files, warnings }) => {
      console.log = silenced;
      console.warn = silencedWarn;
      console.log(`wrote ${Object.keys(files).length} files to ${outDir}`);
      for (const name of Object.keys(files).sort()) console.log(`  ${name}`);
      // Warnings are the graph lint, not a build failure: the fixture is
      // deliberately imperfect in places (an entry with no description, a
      // profile link that is not a markdown link).
      // The sample should lint clean. A warning here means the fixture drifted
      // from what a real graph looks like, or the lint learned something new —
      // either way it is worth seeing rather than burying.
      for (const w of warnings) console.log(`  warning: ${w.rule}: ${w.message}`);
    })
    .catch((error) => {
      console.log = silenced;
      console.warn = silencedWarn;
      console.error('failed to build sample export:', error);
      process.exit(1);
    });
}
