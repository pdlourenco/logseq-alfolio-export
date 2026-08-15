// ============================================================================
// logseq-alfolio-export — Export Logseq data to al-folio YAML
// ============================================================================

const PLUGIN_ID = "logseq-alfolio-export";
const EXPORT_PREFIX = "_logseq_export"; // subfolder in sandbox storage

// ============================================================================
// YAML Serializer (minimal, no dependencies)
// ============================================================================

// Words a YAML parser reads as something other than a string. The consumer is
// Python/PyYAML, which is YAML 1.1 — so `yes`, `no`, `on`, `off` are booleans
// there even though a YAML 1.2 parser keeps them as strings. (The bare `y`/`n`
// forms are listed by YAML 1.1 but PyYAML 6 does not implement them: it returns
// the string. They are quoted anyway, since another parser may.) Quoting costs
// nothing and stops a value changing type in transit.
const YAML_RESERVED_WORDS =
  /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF|y|Y|n|N)$/;

// A plain scalar may not open with an indicator character: the parser reads it
// as structure. `- x` starts a list, `&x` an anchor, `!x` a tag, and so on.
const YAML_LEADING_INDICATOR = /^[-+?:,[\]{}#&*!|>'"%@`.]/;

/** Whether a string has to be quoted to survive a round trip through a parser. */
function needsQuoting(str) {
  return (
    str === "" ||
    str !== str.trim() ||          // leading/trailing space is dropped unquoted
    str.includes("\n") ||
    str.includes(":") ||
    str.includes("#") ||
    str.includes("'") ||
    str.includes('"') ||
    YAML_LEADING_INDICATOR.test(str) ||
    YAML_RESERVED_WORDS.test(str) ||
    /^\d/.test(str)                // would be read as a number or a date
  );
}

/**
 * Serialize a mapping.
 *
 * `dropNulls` is the one contractual asymmetry in this serializer, and it is
 * deliberate: null-valued keys vanish from a mapping but are written out as
 * explicit `null` inside a list item. Contract v1 accommodates both spellings
 * and the site's transform treats them identically, so changing either is a
 * breaking shape change that needs a schema_version bump. See ROADMAP.md.
 */
function toYAMLMapping(obj, indent, dropNulls) {
  const pad = "  ".repeat(indent);
  const entries = Object.entries(obj);
  if (entries.length === 0) return pad + "{}";
  // A mapping whose keys all drop is handled at the end of this function: at
  // the root it becomes "{}" so the file is always a well-formed document.

  const lines = [];
  for (const [rawKey, v] of entries) {
    // Keys need the same quoting as values: personal.yml is keyed by page slug
    // and publication_overrides.yml by BibTeX cite-key, neither of which is
    // guaranteed to be a safe plain scalar.
    const k = needsQuoting(rawKey) ? JSON.stringify(rawKey) : rawKey;
    if (v === null || v === undefined) {
      if (!dropNulls) lines.push(pad + k + ": null");
      continue;
    }
    if (Array.isArray(v)) {
      lines.push(v.length === 0 ? pad + k + ": []" : pad + k + ":\n" + toYAML(v, indent + 1));
    } else if (typeof v === "object") {
      lines.push(pad + k + ":\n" + toYAML(v, indent + 1));
    } else {
      lines.push(pad + k + ": " + toYAML(v).trim());
    }
  }
  // Whole documents only (D65). A root mapping whose keys all dropped would
  // otherwise emit nothing, and an empty file is not a well-formed YAML
  // document — the site's transform survives it only because it defends with
  // `yaml.safe_load(text) or {}`, and that is the consumer's defence, not this
  // format's guarantee. Nested `key:` with nothing under it is left alone: the
  // consumer treats explicit-null and absent as equivalent, so changing that
  // would be a semantic change rather than a spelling one.
  if (lines.length === 0 && indent === 0) return "{}";
  return lines.join("\n");
}

/**
 * Turn an already-indented block into a list item by grafting `- ` onto its
 * first line. The block is rendered one level deeper, which is exactly the
 * width of the `- ` marker, so the remaining lines already sit correctly and
 * nested structure survives. Trimming the block instead — as this used to —
 * collapsed nested collections into unparseable output.
 */
function toYAMLListItem(item, indent) {
  const pad = "  ".repeat(indent);
  const block = (typeof item === "object" && item !== null && !Array.isArray(item))
    ? toYAMLMapping(item, indent + 1, false)
    : toYAML(item, indent + 1);

  const lines = block.split("\n");
  lines[0] = pad + "- " + lines[0].slice(pad.length + 2);
  return lines.join("\n");
}

function toYAML(obj, indent = 0) {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return pad + "null";
  if (typeof obj === "boolean") return pad + (obj ? "true" : "false");
  if (typeof obj === "number") return pad + String(obj);
  if (typeof obj === "string") {
    return pad + (needsQuoting(obj) ? JSON.stringify(obj) : obj);
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return pad + "[]";
    return obj.map((item) => toYAMLListItem(item, indent)).join("\n");
  }
  if (typeof obj === "object") {
    return toYAMLMapping(obj, indent, true);
  }
  return pad + String(obj);
}

// ============================================================================
// Property Parsing Utilities
// ============================================================================

/** Strip [[ and ]] from a string */
function stripBrackets(val) {
  if (typeof val !== "string") return val;
  return val.replace(/\[\[([^\]]*)\]\]/g, "$1");
}

/** Extract all [[page refs]] from a string, returning array of page names */
function extractRefs(val) {
  if (typeof val !== "string") return [];
  const matches = val.match(/\[\[([^\]]*)\]\]/g);
  if (!matches) return [];
  return matches.map((m) => m.slice(2, -2));
}

/** Convert date from Logseq format to al-folio: [[2022/07]] → 2022-07 */
function convertDate(val) {
  if (typeof val !== "string") return val;
  const stripped = stripBrackets(val);
  return stripped.replace(/\//g, "-");
}

/** Parse a property value that may contain comma-separated [[refs]] */
function parseCommaSeparatedRefs(val) {
  if (typeof val !== "string") return [];
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Parse people refs: "Prof. [[Paulo Oliveira]], Prof. [[Pedro Batista]]" */
function parsePeopleRefs(val) {
  if (typeof val !== "string") return [];
  return val.split(",").map((s) => {
    const trimmed = s.trim();
    const match = trimmed.match(/^((?:Prof\.|Dr\.|Eng\.)\s+)?\[\[([^\]]+)\]\]$/);
    if (match) {
      return { title: (match[1] || "").trim(), name: match[2] };
    }
    return { title: "", name: stripBrackets(trimmed) };
  });
}

/** Parse markdown link: [label](url) → { label, url } */
function parseMarkdownLink(val) {
  if (typeof val !== "string") return null;
  const match = val.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
  if (match) return { label: match[1], url: match[2] };
  return null;
}

/** Extract the "title" from a block's content (first line, before properties).
 *  Logseq block content includes all lines, including `key:: val` properties.
 *  We want just the first non-property, non-empty line. */
function extractBlockTitle(content) {
  // Not just falsy: Logseq's block content shape is an untested assumption
  // (seed.md P1), and a non-string here used to throw and take the whole
  // export down with it.
  if (typeof content !== "string" || !content) return "";
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.replace(/^-\s*/, "").trim();
    // Skip empty, property lines, and markdown headers
    if (!trimmed) continue;
    if (/^[a-z][-a-z]*::/.test(trimmed)) continue;
    return stripBrackets(trimmed);
  }
  return "";
}

/** Get clean string property, stripping brackets.
 *  Logseq may parse properties as arrays for [[refs]], so we handle both. */
function cleanProp(props, key) {
  const val = props[key];
  if (val === undefined || val === null) return null;
  // Logseq sometimes parses [[ref]] properties into arrays
  if (Array.isArray(val)) {
    return val.map((v) => stripBrackets(String(v))).join(", ") || null;
  }
  const str = String(val);
  return stripBrackets(str) || null;
}

/** Get raw property string (preserving [[]] for later processing) */
function rawProp(props, key) {
  const val = props[key];
  if (val === undefined || val === null) return null;
  // If Logseq parsed it as array, reconstruct [[ref]] syntax
  if (Array.isArray(val)) {
    return val.map((v) => `[[${v}]]`).join(", ");
  }
  return String(val);
}

// ============================================================================
// Resolution Caches (built once per export)
// ============================================================================

class ResolutionCache {
  constructor() {
    this.pageCache = {};      // pageName → { originalName, properties }
    this.aliasMap = {};       // alias → canonicalName
    this.iconMap = {};        // pageName → icon key
    this.abbreviationMap = {}; // pageName → abbreviation
    this.affiliationMap = {};  // personName → { affiliation, abbreviation }
  }

  /** Build all caches from the graph */
  async build() {
    console.log("[al-folio] Building resolution caches...");

    // Fetch all pages
    const allPages = await logseq.Editor.getAllPages();
    if (!allPages) return;

    for (const page of allPages) {
      const name = page.originalName || page.name;
      this.pageCache[name.toLowerCase()] = {
        originalName: name,
        properties: page.properties || {},
      };

      // Build alias map
      const aliases = page.properties?.alias;
      if (aliases) {
        const aliasList = Array.isArray(aliases) ? aliases : String(aliases).split(",").map((s) => s.trim());
        for (const alias of aliasList) {
          this.aliasMap[alias.toLowerCase()] = name;
        }
      }

      // Build icon map
      const icon = page.properties?.icon;
      if (icon) this.iconMap[name.toLowerCase()] = String(icon);

      // Build abbreviation map
      const abbr = page.properties?.abbreviation;
      if (abbr) this.abbreviationMap[name.toLowerCase()] = String(abbr);

      // Build affiliation map (for person pages)
      const type = cleanProp(page.properties || {}, "type");
      if (type === "person") {
        const affiliation = cleanProp(page.properties || {}, "affiliation");
        if (affiliation) {
          this.affiliationMap[name.toLowerCase()] = {
            affiliation: affiliation,
            abbreviation: this.abbreviationMap[affiliation.toLowerCase()] || affiliation,
          };
        }
      }
    }

    // Second pass: resolve affiliation abbreviations now that all pages are loaded
    for (const [personName, info] of Object.entries(this.affiliationMap)) {
      const abbrKey = info.affiliation.toLowerCase();
      if (this.abbreviationMap[abbrKey]) {
        info.abbreviation = this.abbreviationMap[abbrKey];
      }
    }

    console.log(`[al-folio] Cache built: ${Object.keys(this.pageCache).length} pages, ${Object.keys(this.aliasMap).length} aliases`);
  }

  /** Whether a [[ref]] resolves to a real page, directly or through an alias */
  hasPage(name) {
    if (!name) return false;
    const lower = String(name).toLowerCase();
    return Boolean(this.pageCache[lower] || this.aliasMap[lower]);
  }

  /** Whether a person has a page carrying an affiliation we can resolve */
  hasPerson(name) {
    if (!name) return false;
    const lower = String(name).toLowerCase();
    if (this.affiliationMap[lower]) return true;
    const resolved = String(this.resolvePageName(name)).toLowerCase();
    return Boolean(this.affiliationMap[resolved]);
  }

  /** Resolve a page name (possibly an alias) to its canonical name */
  resolvePageName(name) {
    if (!name) return name;
    const lower = name.toLowerCase();
    // Direct match
    if (this.pageCache[lower]) return this.pageCache[lower].originalName;
    // Alias match
    if (this.aliasMap[lower]) return this.aliasMap[lower];
    // No match, return as-is
    return name;
  }

  /** Resolve a property value, expanding all [[refs]] to canonical names */
  resolveValue(val) {
    if (typeof val !== "string") return val;
    return val.replace(/\[\[([^\]]*)\]\]/g, (_, refName) => {
      return this.resolvePageName(refName);
    });
  }

  /** Get icon for an organization/institution */
  getIcon(orgName) {
    if (!orgName) return null;
    return this.iconMap[orgName.toLowerCase()] || null;
  }

  /** Get abbreviation for an institution */
  getAbbreviation(instName) {
    if (!instName) return null;
    return this.abbreviationMap[instName.toLowerCase()] || null;
  }

  /** Resolve supervisor with affiliation annotation */
  resolveSupervisor(personRef, studentUniversities) {
    const name = personRef.name;
    const resolved = this.resolvePageName(name);
    const affInfo = this.affiliationMap[name.toLowerCase()] || this.affiliationMap[resolved.toLowerCase()];

    let affLabel = null;
    if (affInfo) {
      // Check if affiliation is different from student's universities
      const uniNames = studentUniversities.map((u) => u.toLowerCase());
      if (!uniNames.includes(affInfo.affiliation.toLowerCase())) {
        affLabel = affInfo.abbreviation || affInfo.affiliation;
      }
    }

    return {
      name: (personRef.title ? personRef.title + " " : "") + resolved,
      affiliation: affLabel,
    };
  }
}

// ============================================================================
// Export manifest
// ============================================================================

// The intermediate-format contract version this export is produced against.
// The site's transform refuses a version it does not know, and refuses an
// export carrying none, rather than guessing at a shape. Bump only alongside
// docs/intermediate-schema/ in the site repo.
const SCHEMA_VERSION = 1;

/**
 * The plugin's released version, read from package.json rather than repeated
 * as a literal so it cannot silently disagree with what shipped.
 *
 * There is no build step, so this is a runtime fetch relative to index.html.
 * `plugin_version` is optional in the contract, so a failure omits the field
 * and warns rather than substituting a guess — a stale hardcoded version is
 * exactly the problem this replaces.
 *
 * Deliberately not cached: an export is a manual, occasional action, so one
 * local read costs nothing, and a reloaded plugin reports its new version
 * rather than whichever one the session started with.
 */
async function getPluginVersion(warnings) {
  try {
    const response = await fetch("./package.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const pkg = await response.json();
    return pkg.version || null;
  } catch (error) {
    if (warnings) {
      warnings.push({
        rule: "plugin-version",
        message: `could not read package.json (${error.message}); manifest omits plugin_version.`,
      });
    }
    return null;
  }
}

/** Lowercase hex SHA-256 of a string, or null where WebCrypto is unavailable. */
async function sha256Hex(text) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Content hashes for every exported file *except* the manifest itself — a
 * manifest cannot contain its own hash. This is what lets the consumer tell a
 * truncated or half-finished copy from a real export.
 *
 * `hashes` is optional in the contract, so if WebCrypto turns out to be
 * unavailable in the plugin sandbox the export still succeeds without it,
 * with a warning. Vendoring a SHA-256 implementation would break the
 * zero-dependency runtime rule for a field the contract calls optional.
 */
async function computeHashes(files, warnings) {
  if (!globalThis.crypto?.subtle) {
    if (warnings) {
      warnings.push({
        rule: "hashes-unavailable",
        message: "WebCrypto is not available here, so manifest.json omits content hashes.",
      });
    }
    return null;
  }
  const hashes = {};
  for (const name of Object.keys(files).sort(cmpString)) {
    hashes[name] = await sha256Hex(files[name]);
  }
  return hashes;
}

// ============================================================================
// Settings
// ============================================================================

// Used only as the settings-schema default — never as a fallback in logic.
const DEFAULT_WEBSITE_NAME = "plourenco.eu";

/**
 * The site tag to filter graph pages on.
 *
 * Reads the setting once. If it is unset the export still runs against the
 * schema default, but says so — silently defaulting is how a graph belonging
 * to someone else exports nothing and looks like it worked.
 */
function getWebsiteName(warnings) {
  const configured = logseq.settings?.websiteName;
  if (configured) return configured;
  if (warnings) {
    warnings.push({
      rule: "settings",
      message: `websiteName is not set; falling back to "${DEFAULT_WEBSITE_NAME}". Set it in the plugin settings.`,
    });
  }
  return DEFAULT_WEBSITE_NAME;
}

/**
 * Blocks reach the transformers in two shapes: nested (`block.properties`,
 * from getPageBlocksTree and the fixtures) and flattened (properties spread
 * onto the entry, which is what runExport builds for standalone pages).
 * Reading only the nested shape meant students, jury and projects were always
 * empty in a real export while every unit test passed.
 */
function entryProps(block) {
  if (!block) return {};
  return block.properties || block;
}

/**
 * Drop a trailing degree disambiguator from a name.
 *
 * A person with two degrees has one block per degree, and the second carries a
 * suffix so the block titles differ (`Hugo Pereira (PhD)`). The suffix is a
 * graph-authoring device, not part of the person's name.
 */
function stripDisambiguationSuffix(name) {
  if (typeof name !== "string") return name;
  return name
    .replace(/\s*\((?:PhD|Ph\.?\s?D\.?|M\.?\s?Sc\.?|MSc|MS|B\.?\s?Sc\.?|BSc|Postdoc|Post-doc)\)\s*$/i, "")
    .trim();
}

// ============================================================================
// Deterministic ordering
//
// Logseq's page and block order is not stable across re-indexes, and the
// export is committed to the site repo — unstable order makes every git diff
// useless and, once manifest hashes land (PR 2.5), makes every hash churn.
// Comparisons are plain codepoint order, never localeCompare, which varies by
// machine locale and would defeat the point.
// ============================================================================

function cmpString(a, b) {
  const x = a == null ? "" : String(a);
  const y = b == null ? "" : String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Newest first; entries with no date sort last, then by tiebreak. */
function cmpDateDesc(a, b) {
  const x = a == null ? "" : String(a);
  const y = b == null ? "" : String(b);
  if (!x && !y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x < y ? 1 : x > y ? -1 : 0;
}

function byDateThen(dateKey, ...tiebreaks) {
  return (a, b) => {
    const d = cmpDateDesc(a[dateKey], b[dateKey]);
    if (d !== 0) return d;
    for (const key of tiebreaks) {
      const t = cmpString(a[key], b[key]);
      if (t !== 0) return t;
    }
    return 0;
  };
}

function byFields(...keys) {
  return (a, b) => {
    for (const key of keys) {
      const t = cmpString(a[key], b[key]);
      if (t !== 0) return t;
    }
    return 0;
  };
}

/** Return a new object with keys in sorted order. */
function sortKeys(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort(cmpString)) out[key] = obj[key];
  return out;
}

/**
 * Impose a total order on every exported collection.
 *
 * Dated sections are newest-first, which is also how a CV reads; undated ones
 * are alphabetical. Personal-page sections keep their authored order, since
 * that is content the graph owner arranged deliberately rather than an
 * accident of indexing.
 */
function sortExport(cv, personalPages, pubOverrides) {
  cv.experience.sort(byDateThen("start", "position", "organization"));
  cv.education.sort(byDateThen("start", "degree", "field"));
  cv.awards.sort(byDateThen("date", "title"));
  cv.projects.sort(byDateThen("start", "name"));
  cv.skills.sort(byFields("group", "name"));
  cv.research_interests.sort(byFields("group", "name"));
  cv.languages.sort(byFields("name"));
  cv.teaching.supervised_students.sort(byDateThen("start", "name"));
  cv.teaching.jury.sort(byDateThen("start", "name"));
  return {
    cv,
    personalPages: sortKeys(personalPages),
    pubOverrides: sortKeys(pubOverrides),
  };
}

// ============================================================================
// Pre-export validation
//
// Reports, never fails: a graph problem should not cost you the export, but it
// should not be invisible either.
// ============================================================================

/** Properties an entry of each type needs before it can produce a usable record. */
const REQUIRED_PROPS = {
  experience: ["position", "organization", "start"],
  education: ["degree", "start"],
  award: ["date"],
  skill: ["group"],
  student: ["university", "supervisor"],
  project: ["start"],
};

const DATE_PROPS = ["start", "end", "date"];
const VALID_DATE = /^\d{4}(?:\/\d{1,2}(?:\/\d{1,2})?)?$/;

class ExportLint {
  constructor(cache) {
    this.cache = cache;
    this.warnings = [];
    this.iconKeys = new Set();
  }

  warn(rule, message) {
    this.warnings.push({ rule, message });
  }

  /** Every [[ref]] in a value must resolve to a real page. */
  checkRefs(label, value) {
    if (typeof value !== "string") return;
    for (const ref of extractRefs(value)) {
      if (ref.includes("(")) {
        this.warn(
          "ref-parentheses",
          `${label}: [[${ref}]] contains parentheses — usually an affiliation baked into the link, which cannot resolve to a page.`,
        );
      }
      if (!this.cache.hasPage(ref)) {
        this.warn("unresolved-ref", `${label}: [[${ref}]] does not resolve to any page.`);
      }
    }
  }

  checkDates(label, props) {
    for (const key of DATE_PROPS) {
      const raw = rawProp(props, key);
      if (!raw) continue;
      const stripped = stripBrackets(String(raw)).trim();
      if (!VALID_DATE.test(stripped)) {
        this.warn("bad-date", `${label}: ${key}:: "${stripped}" is not YYYY, YYYY/MM or YYYY/MM/DD.`);
      }
    }
  }

  checkRequired(label, type, props) {
    const required = REQUIRED_PROPS[type];
    if (!required) return;
    for (const key of required) {
      if (!rawProp(props, key)) {
        this.warn("missing-property", `${label}: type "${type}" needs ${key}::, which is missing.`);
      }
    }
  }

  checkSupervisors(label, props) {
    const raw = rawProp(props, "supervisor");
    if (!raw) return;
    for (const person of parsePeopleRefs(String(raw))) {
      if (!person.name) continue;
      if (!this.cache.hasPerson(person.name)) {
        this.warn(
          "unknown-supervisor",
          `${label}: supervisor "${person.name}" has no person page, so their affiliation cannot be resolved.`,
        );
      }
    }
  }

  collectIcons(props) {
    const icon = cleanProp(props, "icon");
    if (icon) this.iconKeys.add(icon);
  }

  /** Lint one entry, whichever shape it arrived in. */
  checkEntry(entry) {
    const props = entryProps(entry);
    const type = cleanProp(props, "type");
    const label = stripDisambiguationSuffix(extractBlockTitle(entry._blockContent || entry.content)) ||
      cleanProp(props, "position") || cleanProp(props, "degree") || type || "entry";

    this.collectIcons(props);
    this.checkDates(label, props);
    if (type) this.checkRequired(label, type, props);
    if (type === "student") this.checkSupervisors(label, props);

    for (const [key, value] of Object.entries(props)) {
      if (key === "_blockContent" || key === "properties") continue;
      this.checkRefs(`${label}.${key}`, typeof value === "string" ? value : null);
    }
  }

  checkAll(entryGroups) {
    for (const entries of entryGroups) {
      for (const entry of entries || []) this.checkEntry(entry);
    }
    if (this.iconKeys.size > 0) {
      this.warn(
        "icons-used",
        `icon keys referenced (the site must map these in icon_map.yml): ${[...this.iconKeys].sort(cmpString).join(", ")}`,
      );
    }
    return this.warnings;
  }

  /** Warnings that indicate a problem, as opposed to the icon inventory. */
  get problems() {
    return this.warnings.filter((w) => w.rule !== "icons-used");
  }
}

// ============================================================================
// Data Extraction
// ============================================================================

/** Extract properties from blocks on a namespace page (e.g., CV/Experience) */
async function extractNamespaceEntries(pageName, cache) {
  const blocks = await logseq.Editor.getPageBlocksTree(pageName);
  if (!blocks) return [];

  const entries = [];
  for (const block of blocks) {
    if (!block.properties || Object.keys(block.properties).length === 0) continue;
    // Skip template blocks and comments
    if (block.properties.template || block.content?.startsWith("#")) continue;

    const entry = { _blockContent: block.content };
    for (const [key, val] of Object.entries(block.properties)) {
      entry[key] = val;
    }
    entries.push(entry);

    // Check children (for multi-entry pages like Hugo Pereira with M.Sc. + PhD)
    if (block.children) {
      for (const child of block.children) {
        if (child.properties && Object.keys(child.properties).length > 0 && child.properties.type) {
          const childEntry = { _blockContent: child.content };
          for (const [key, val] of Object.entries(child.properties)) {
            childEntry[key] = val;
          }
          entries.push(childEntry);
        }
      }
    }
  }
  return entries;
}

/** Find all standalone pages with website:: matching configured site */
// Currently uncalled: runExport's page scan replaced it, and its result was
// being discarded. Kept because PR 3's GraphReader seam needs a datalog page
// query and this is that query — but it goes through getWebsiteName() like
// everything else, so reviving it cannot silently select nothing on a graph
// whose websiteName differs. PR 3 should adopt it into the reader or delete it.
async function findWebsitePages(cache) {
  const siteName = getWebsiteName();
  try {
    const results = await logseq.DB.datascriptQuery(`
      [:find (pull ?b [*])
       :where
       [?b :block/properties ?props]
       [(get ?props :website) ?w]]
    `);
    if (!results) return [];
    return results.flat().filter((b) => {
      const w = String(b.properties?.website || "");
      return w.includes(siteName);
    });
  } catch (e) {
    console.warn("[al-folio] Datalog query failed, falling back to page scan", e);
    return [];
  }
}

// ============================================================================
// Transformers — Convert raw Logseq data to al-folio YAML structures
// ============================================================================

function transformExperience(entries, cache) {
  return entries.filter((e) => cleanProp(e, "type") === "experience").map((e) => {
    const org = cleanProp(e, "organization");
    return {
      position: cleanProp(e, "position"),
      organization: cache.resolvePageName(org),
      location: cleanProp(e, "location"),
      start: convertDate(rawProp(e, "start")),
      end: convertDate(rawProp(e, "end")),
      description: cleanProp(e, "description"),
      icon: cache.getIcon(org),
    };
  }).filter((e) => e.position);
}

function transformEducation(entries, cache) {
  return entries.filter((e) => cleanProp(e, "type") === "education").map((e) => {
    const uni = cleanProp(e, "university");
    const school = cleanProp(e, "school");
    const advisorsRaw = rawProp(e, "advisors");
    const advisors = advisorsRaw ? parsePeopleRefs(advisorsRaw).map((p) => {
      const resolved = cache.resolvePageName(p.name);
      return (p.title ? p.title + " " : "") + resolved;
    }) : null;

    return {
      degree: cleanProp(e, "degree"),
      field: cleanProp(e, "field"),
      university: uni ? cache.resolveValue(rawProp(e, "university")).split(",").map((s) => stripBrackets(s.trim())) : null,
      school: school ? cache.resolvePageName(school) : null,
      start: convertDate(rawProp(e, "start")),
      end: convertDate(rawProp(e, "end")),
      grade: cleanProp(e, "grade"),
      thesis_title: cleanProp(e, "thesis-title"),
      advisors: advisors,
      institute: cleanProp(e, "institute") ? cache.resolvePageName(cleanProp(e, "institute")) : null,
      grant: cleanProp(e, "grant"),
      award: cleanProp(e, "award"),
      courses: cleanProp(e, "courses"),
      icon: cache.getIcon(school || uni),
    };
  }).filter((e) => e.degree);
}

function transformAwards(entries, cache) {
  return entries.filter((e) => cleanProp(e, "type") === "award").map((e) => {
    const title = extractBlockTitle(e._blockContent);
    return {
      title: title,
      awarder: cleanProp(e, "awarder") ? cache.resolvePageName(cleanProp(e, "awarder")) : null,
      date: convertDate(rawProp(e, "date")),
      category: cleanProp(e, "category"),
      description: cleanProp(e, "description"),
      icon: cache.getIcon(cleanProp(e, "awarder")),
    };
  }).filter((e) => e.title);
}

function transformSkills(entries, cache) {
  return entries.filter((e) => cleanProp(e, "type") === "skill").map((e) => {
    const name = extractBlockTitle(e._blockContent);
    return {
      name: name,
      group: cleanProp(e, "group"),
      level: cleanProp(e, "level") ? parseInt(cleanProp(e, "level")) : null,
      icon: cleanProp(e, "icon"),
    };
  }).filter((e) => e.name);
}

function transformLanguages(entries, cache) {
  return entries.filter((e) => cleanProp(e, "type") === "language").map((e) => {
    const name = extractBlockTitle(e._blockContent);
    return {
      name: name,
      speaking: cleanProp(e, "speaking") ? parseInt(cleanProp(e, "speaking")) : null,
      understanding: cleanProp(e, "understanding") ? parseInt(cleanProp(e, "understanding")) : null,
      writing: cleanProp(e, "writing") ? parseInt(cleanProp(e, "writing")) : null,
      mother_tongue: cleanProp(e, "mother-tongue") === "true",
    };
  }).filter((e) => e.name);
}

function transformResearchInterests(entries, cache) {
  return entries.filter((e) => cleanProp(e, "type") === "research-interest").map((e) => {
    const name = extractBlockTitle(e._blockContent);
    return {
      name: name,
      level: cleanProp(e, "level") ? parseInt(cleanProp(e, "level")) : null,
      group: cleanProp(e, "group"),
      icon: cleanProp(e, "icon"),
    };
  }).filter((e) => e.name);
}

function transformStudents(blocks, cache) {
  const supervised = [];
  const jury = [];

  for (const b of blocks) {
    const props = entryProps(b);
    if (cleanProp(props, "type") !== "student") continue;

    const uniRaw = rawProp(props, "university") || "";
    const universities = extractRefs(uniRaw).map((u) => cache.resolvePageName(u));

    const supervisorsRaw = rawProp(props, "supervisor") || "";
    const supervisorsParsed = parsePeopleRefs(supervisorsRaw);
    const supervisors = supervisorsParsed.map((p) =>
      cache.resolveSupervisor(p, universities)
    );

    const name = stripDisambiguationSuffix(extractBlockTitle(b._blockContent || b.content));

    const entry = {
      name: name,
      thesis_type: cleanProp(props, "thesis-type"),
      degree: cleanProp(props, "degree"),
      thesis_title: cleanProp(props, "thesis-title"),
      university: universities,
      supervisors: supervisors.map((s) =>
        s.affiliation ? s.name + " (" + s.affiliation + ")" : s.name
      ),
      start: convertDate(rawProp(props, "start")),
      end: convertDate(rawProp(props, "end")),
      status: cleanProp(props, "status") || (cleanProp(props, "end") ? "completed" : "current"),
      grade: cleanProp(props, "grade"),
      award: cleanProp(props, "award"),
      description: cleanProp(props, "description"),
      current_position: cleanProp(props, "current-position"),
      icon: universities.length > 0 ? cache.getIcon(universities[0]) : null,
    };

    const juryRole = cleanProp(props, "jury-role");
    if (juryRole === "Supervisor") {
      supervised.push(entry);
      jury.push({ ...entry, jury_role: juryRole });
    } else if (juryRole === "Rapporteur" || juryRole === "Examiner") {
      jury.push({ ...entry, jury_role: juryRole });
    } else {
      supervised.push(entry);
    }
  }

  return { supervised, jury };
}

function transformProjects(blocks, cache) {
  return blocks.filter((b) => {
    const props = entryProps(b);
    return cleanProp(props, "type") === "project";
  }).map((b) => {
    const props = entryProps(b);
    const inst = cleanProp(props, "institution");
    const name = extractBlockTitle(b._blockContent || b.content);

    return {
      name: name,
      institution: inst ? cache.resolvePageName(inst) : null,
      category: cleanProp(props, "category"),
      start: convertDate(rawProp(props, "start")),
      end: convertDate(rawProp(props, "end")),
      description: cleanProp(props, "description"),
      url: cleanProp(props, "url"),
      code: cleanProp(props, "code"),
      keywords: cleanProp(props, "keywords"),
      importance: cleanProp(props, "importance") ? parseInt(cleanProp(props, "importance")) : null,
      icon: inst ? cache.getIcon(inst) : cleanProp(props, "icon"),
    };
  }).filter((e) => e.name);
}

function transformProfile(entries, cache) {
  const e = entries[0];
  if (!e) return {};

  const profile = {};
  const simpleKeys = [
    "name-long", "name-short", "initials",
    "email-personal", "email-work", "bio-short", "bio-long",
  ];
  for (const key of simpleKeys) {
    const val = cleanProp(e, key);
    if (val) profile[key.replace(/-/g, "_")] = val;
  }

  // Parse markdown links for network profiles
  const linkKeys = [
    "web", "linkedin", "twitter", "github", "instagram",
    "lastfm", "soundcloud", "orcid", "scholar", "researchgate",
    "cienciavitae", "publons",
  ];
  for (const key of linkKeys) {
    const raw = rawProp(e, key);
    if (!raw) continue;
    const link = parseMarkdownLink(raw);
    if (link) {
      profile[key] = { id: link.label, url: link.url };
    } else {
      profile[key] = { id: raw, url: null };
    }
  }

  return profile;
}

function transformPersonalPage(pageName, blocks, cache) {
  const firstBlock = blocks[0];
  if (!firstBlock) return null;

  const props = firstBlock.properties || {};
  const result = {
    title: extractBlockTitle(firstBlock.content) || pageName,
    description: cleanProp(props, "description"),
  };

  // Extract page-level properties
  for (const [key, val] of Object.entries(props)) {
    if (["type", "website", "description"].includes(key)) continue;
    const link = parseMarkdownLink(String(val));
    if (link) {
      result[key] = { id: link.label, url: link.url };
    } else {
      result[key] = stripBrackets(String(val));
    }
  }

  // Extract child blocks organized by section headers
  const sections = {};
  let currentSection = "_root";

  function processChildren(children) {
    if (!children) return;
    for (const child of children) {
      const content = child.content || "";
      // Check if this is a section header (## Header)
      const headerMatch = content.match(/^##\s+(.+)/);
      if (headerMatch) {
        currentSection = headerMatch[1].trim().toLowerCase().replace(/\s+/g, "_");
        sections[currentSection] = [];
        continue;
      }

      if (child.properties && Object.keys(child.properties).length > 0) {
        const entry = {
          _name: extractBlockTitle(content),
        };
        for (const [key, val] of Object.entries(child.properties)) {
          const link = parseMarkdownLink(String(val));
          if (link) {
            entry[key] = { id: link.label, url: link.url };
          } else {
            entry[key] = stripBrackets(String(val));
          }
        }
        if (!sections[currentSection]) sections[currentSection] = [];
        sections[currentSection].push(entry);
      }
    }
  }

  processChildren(firstBlock.children);
  result.sections = sections;
  return result;
}

function transformPublicationOverrides(entries, cache) {
  const overrides = {};
  for (const e of entries) {
    const citeKey = cleanProp(e, "cite-key");
    if (!citeKey) continue;
    overrides[citeKey] = {
      selected: cleanProp(e, "selected") === "true",
      abbr: cleanProp(e, "abbr"),
      preview: cleanProp(e, "preview"),
    };
  }
  return overrides;
}

// ============================================================================
// Main Export Pipeline
// ============================================================================

/**
 * Run the export.
 *
 * @param {object}  [options]
 * @param {boolean} [options.dryRun] Run everything, log the output, write nothing.
 * @param {Date}    [options.now]    Export timestamp. Injectable so tests can pin
 *                                   the one value in the output that is not a
 *                                   function of the graph.
 */
async function runExport(options = {}) {
  const { dryRun = false, now = new Date() } = options;
  const startTime = Date.now();
  console.log(`[al-folio] Starting export${dryRun ? " (dry run)" : ""}...`);

  try {
    // 1. Build resolution caches
    const cache = new ResolutionCache();
    await cache.build();
    const lint = new ExportLint(cache);

    // 2. Extract CV namespace pages
    const cvPages = {
      experience: await extractNamespaceEntries("CV/Experience", cache),
      education: await extractNamespaceEntries("CV/Education", cache),
      awards: await extractNamespaceEntries("CV/Awards", cache),
      skills: await extractNamespaceEntries("CV/Skills", cache),
      languages: await extractNamespaceEntries("CV/Languages", cache),
      researchInterests: await extractNamespaceEntries("CV/Research Interests", cache),
      profile: await extractNamespaceEntries("CV/Profile", cache),
    };

    // 3. Scan standalone pages for the website:: tag (students, projects)
    const allPages = await logseq.Editor.getAllPages();
    const siteName = getWebsiteName(lint.warnings);
    const standaloneEntries = [];
    for (const page of allPages || []) {
      const props = page.properties || {};
      const w = String(props.website || "");
      if (!w.includes(siteName)) continue;

      const blocks = await logseq.Editor.getPageBlocksTree(page.originalName || page.name);
      if (blocks) {
        for (const block of blocks) {
          if (block.properties && String(block.properties.website || "").includes(siteName)) {
            standaloneEntries.push({
              _blockContent: block.content,
              ...block.properties,
            });
          }
          // Check children
          if (block.children) {
            for (const child of block.children) {
              if (child.properties && child.properties.type) {
                standaloneEntries.push({
                  _blockContent: child.content,
                  ...child.properties,
                });
              }
            }
          }
        }
      }
    }

    // 4. Extract the site namespace (page names follow the configured site)
    const pubOverrides = await extractNamespaceEntries(`${siteName}/Publication Overrides`, cache);
    const blogIdeas = await extractNamespaceEntries(`${siteName}/Blog Ideas`, cache);

    // 5. Extract Personal namespace (only website-tagged)
    const personalPages = {};
    for (const page of allPages || []) {
      const name = page.originalName || page.name;
      if (!name.startsWith("Personal/")) continue;
      const blocks = await logseq.Editor.getPageBlocksTree(name);
      if (!blocks || blocks.length === 0) continue;

      const firstBlock = blocks[0];
      const props = firstBlock.properties || {};
      if (!String(props.website || "").includes(siteName)) continue;

      const slug = name.replace("Personal/", "").toLowerCase().replace(/\s+/g, "_").replace(/&/g, "and");
      personalPages[slug] = transformPersonalPage(name, blocks, cache);
    }

    // 6. Transform data
    const cv = {
      experience: transformExperience(cvPages.experience, cache),
      education: transformEducation(cvPages.education, cache),
      awards: transformAwards(cvPages.awards, cache),
      skills: transformSkills(cvPages.skills, cache),
      languages: transformLanguages(cvPages.languages, cache),
      research_interests: transformResearchInterests(cvPages.researchInterests, cache),
      projects: transformProjects(standaloneEntries, cache),
    };

    const { supervised, jury } = transformStudents(standaloneEntries, cache);
    cv.teaching = {
      supervised_students: supervised,
      jury: jury,
    };

    const profile = transformProfile(cvPages.profile, cache);
    const pubOverridesData = transformPublicationOverrides(pubOverrides, cache);

    // 6b. Lint the source entries, and impose a total order on the output.
    lint.checkAll([
      cvPages.experience, cvPages.education, cvPages.awards, cvPages.skills,
      cvPages.languages, cvPages.researchInterests, cvPages.profile,
      standaloneEntries, pubOverrides, blogIdeas,
    ]);
    const sorted = sortExport(cv, personalPages, pubOverridesData);

    // 7. Generate YAML files
    const files = {};
    files["cv.yml"] = toYAML(sorted.cv);
    files["profile.yml"] = toYAML(profile);
    files["personal.yml"] = toYAML(sorted.personalPages);
    files["publication_overrides.yml"] = toYAML(sorted.pubOverrides);

    // Blog posts as individual files
    for (const entry of blogIdeas) {
      if (cleanProp(entry, "status") !== "published") continue;
      const slug = cleanProp(entry, "slug");
      const date = convertDate(rawProp(entry, "date"));
      if (!slug || !date) continue;
      const filename = `blog/${date}-${slug}.md`;
      const frontmatter = [
        "---",
        `title: "${extractBlockTitle(entry._blockContent) || slug}"`,
        `date: ${date}`,
        `categories: ${cleanProp(entry, "categories") || ""}`,
        `description: ${cleanProp(entry, "description") || ""}`,
        `tags: ${cleanProp(entry, "tags") || ""}`,
        "---",
        "",
      ].join("\n");
      // TODO: extract body from sub-bullets
      files[filename] = frontmatter;
    }

    // 7b. Manifest last: every other file must exist before `files` and
    // `hashes` can describe them. Building it earlier is what made `files`
    // list four entries while five or more were written.
    const hashes = await computeHashes(files, lint.warnings);
    const pluginVersion = await getPluginVersion(lint.warnings);
    const manifest = {
      schema_version: SCHEMA_VERSION,
      exported_at: now.toISOString(),
      website: siteName,
      // Includes manifest.json itself: the consumer cross-checks this list
      // against what is on disk in both directions.
      files: [...Object.keys(files), "manifest.json"].sort(cmpString),
      counts: {
        experience: cv.experience.length,
        education: cv.education.length,
        awards: cv.awards.length,
        skills: cv.skills.length,
        languages: cv.languages.length,
        research_interests: cv.research_interests.length,
        projects: cv.projects.length,
        supervised_students: cv.teaching.supervised_students.length,
        jury: cv.teaching.jury.length,
        personal_pages: Object.keys(sorted.personalPages).length,
        publication_overrides: Object.keys(sorted.pubOverrides).length,
      },
    };
    if (pluginVersion) manifest.plugin_version = pluginVersion;
    if (hashes) manifest.hashes = hashes;
    files["manifest.json"] = JSON.stringify(manifest, null, 2);

    // 8. Report what the lint found. Warnings never fail the export.
    for (const warning of lint.warnings) {
      console.warn(`[al-folio] ${warning.rule}: ${warning.message}`);
    }

    // 9. Write files to sandbox storage, in a stable order.
    const filenames = Object.keys(files).sort(cmpString);
    if (dryRun) {
      for (const filename of filenames) {
        console.log(`[al-folio] (dry run) ${filename}:\n${files[filename]}`);
      }
    } else {
      const storage = logseq.Assets.makeSandboxStorage();
      for (const filename of filenames) {
        const key = `${EXPORT_PREFIX}/${filename}`;
        await storage.setItem(key, files[filename]);
        console.log(`[al-folio] Wrote ${key}`);
      }
    }

    const elapsed = Date.now() - startTime;
    const entryCount = Object.values(cv).reduce(
      (total, section) => total + (Array.isArray(section) ? section.length : 0),
      cv.teaching.supervised_students.length + cv.teaching.jury.length,
    );
    const problems = lint.problems.length;
    const msg = [
      dryRun ? "al-folio dry run complete:" : "al-folio export complete:",
      `${entryCount} entries, ${filenames.length} files`,
      problems > 0 ? `, ${problems} warning${problems === 1 ? "" : "s"} — see console` : "",
      ` (${elapsed}ms)`,
    ].join("");
    console.log(`[al-folio] ${msg}`);
    // Stays a success toast even with warnings: the export did complete, and
    // the count plus "see console" is the signal. Only a thrown error is a
    // failure toast.
    logseq.UI.showMsg(msg, "success");
    return { files, warnings: lint.warnings };

  } catch (error) {
    console.error("[al-folio] Export failed:", error);
    logseq.UI.showMsg(`al-folio export failed: ${error.message}`, "error");
  }
}

// ============================================================================
// Plugin Initialization
// ============================================================================

function main() {
  console.log("[al-folio] Plugin loaded");

  // Register toolbar button
  logseq.App.registerUIItem("toolbar", {
    key: "alfolio-export",
    template: `
      <a class="button" data-on-click="exportToAlFolio" title="Export to al-folio">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </a>
    `,
  });

  // Register commands
  logseq.App.registerCommandPalette(
    { key: "alfolio-export", label: "Export to al-folio" },
    () => runExport()
  );

  logseq.App.registerCommandPalette(
    { key: "alfolio-export-dry-run", label: "Export to al-folio (dry run — writes nothing)" },
    () => runExport({ dryRun: true })
  );

  // Handle toolbar click
  logseq.provideModel({
    exportToAlFolio() {
      runExport();
    },
  });

  // Auto-export on graph load (configurable)
  logseq.App.onGraphAfterIndexed(() => {
    const autoExport = logseq.settings?.autoExportOnLoad ?? false;
    if (autoExport) {
      console.log("[al-folio] Auto-exporting on graph load...");
      // Delay slightly to ensure DB is fully ready
      setTimeout(runExport, 3000);
    }
  });

  // Plugin settings
  logseq.useSettingsSchema([
    {
      key: "autoExportOnLoad",
      type: "boolean",
      title: "Auto-export on graph load",
      description: "Automatically run export when Logseq opens the graph",
      default: false,
    },
    {
      key: "websiteName",
      type: "string",
      title: "Website page name",
      description: "The Logseq page name for your website (used to filter website:: property)",
      default: DEFAULT_WEBSITE_NAME,
    },
  ]);
}

if (typeof logseq !== "undefined") {
  logseq.ready(main).catch(console.error);
}

// Expose internals for Node.js test environments
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    toYAML,
    stripBrackets, extractRefs, convertDate,
    parseCommaSeparatedRefs, parsePeopleRefs, parseMarkdownLink,
    extractBlockTitle, cleanProp, rawProp,
    getWebsiteName, entryProps, stripDisambiguationSuffix,
    cmpString, cmpDateDesc, sortKeys, sortExport,
    ExportLint, DEFAULT_WEBSITE_NAME,
    ResolutionCache,
    extractNamespaceEntries, findWebsitePages,
    transformExperience, transformEducation, transformAwards,
    transformSkills, transformLanguages, transformResearchInterests,
    transformStudents, transformProjects,
    transformProfile, transformPersonalPage, transformPublicationOverrides,
    runExport,
  };
}
