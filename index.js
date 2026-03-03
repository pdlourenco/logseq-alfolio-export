// ============================================================================
// logseq-alfolio-export — Export Logseq data to al-folio YAML
// ============================================================================

const PLUGIN_ID = "logseq-alfolio-export";
const EXPORT_PREFIX = "_logseq_export"; // subfolder in sandbox storage

// ============================================================================
// YAML Serializer (minimal, no dependencies)
// ============================================================================

function toYAML(obj, indent = 0) {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) return pad + "null";
  if (typeof obj === "boolean") return pad + (obj ? "true" : "false");
  if (typeof obj === "number") return pad + String(obj);
  if (typeof obj === "string") {
    if (obj.includes("\n") || obj.includes(":") || obj.includes("#") ||
        obj.includes("'") || obj.includes('"') || obj.startsWith("@") ||
        obj.startsWith("*") || obj.startsWith("{") || obj.startsWith("[") ||
        obj === "" || obj === "true" || obj === "false" || obj === "null" ||
        /^\d/.test(obj)) {
      return pad + JSON.stringify(obj);
    }
    return pad + obj;
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return pad + "[]";
    return obj.map((item) => {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item);
        if (entries.length === 0) return pad + "- {}";
        const [firstKey, firstVal] = entries[0];
        let result = pad + "- " + firstKey + ": " + toYAML(firstVal).trim();
        for (let i = 1; i < entries.length; i++) {
          const [k, v] = entries[i];
          if (typeof v === "object" && v !== null) {
            result += "\n" + pad + "  " + k + ":\n" + toYAML(v, indent + 2);
          } else {
            result += "\n" + pad + "  " + k + ": " + toYAML(v).trim();
          }
        }
        return result;
      }
      return pad + "- " + toYAML(item).trim();
    }).join("\n");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj);
    if (entries.length === 0) return pad + "{}";
    return entries.map(([k, v]) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "object" && !Array.isArray(v)) {
        return pad + k + ":\n" + toYAML(v, indent + 1);
      }
      if (Array.isArray(v)) {
        if (v.length === 0) return pad + k + ": []";
        return pad + k + ":\n" + toYAML(v, indent + 1);
      }
      return pad + k + ": " + toYAML(v).trim();
    }).filter(Boolean).join("\n");
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
  if (!content) return "";
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
async function findWebsitePages(cache) {
  const siteName = logseq.settings?.websiteName || "plourenco.eu";
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
    const props = b.properties || {};
    if (cleanProp(props, "type") !== "student") continue;

    const uniRaw = rawProp(props, "university") || "";
    const universities = extractRefs(uniRaw).map((u) => cache.resolvePageName(u));

    const supervisorsRaw = rawProp(props, "supervisor") || "";
    const supervisorsParsed = parsePeopleRefs(supervisorsRaw);
    const supervisors = supervisorsParsed.map((p) =>
      cache.resolveSupervisor(p, universities)
    );

    const name = extractBlockTitle(b._blockContent || b.content);

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
    const props = b.properties || {};
    return cleanProp(props, "type") === "project";
  }).map((b) => {
    const props = b.properties || {};
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

async function runExport() {
  const startTime = Date.now();
  console.log("[al-folio] Starting export...");

  try {
    // 1. Build resolution caches
    const cache = new ResolutionCache();
    await cache.build();

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

    // 3. Find all website-tagged pages (students, projects)
    const websiteBlocks = await findWebsitePages(cache);

    // Also scan standalone pages by walking all pages for website property
    const allPages = await logseq.Editor.getAllPages();
    const siteName = logseq.settings?.websiteName || "plourenco.eu";
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

    // 4. Extract plourenco.eu namespace
    const pubOverrides = await extractNamespaceEntries("plourenco.eu/Publication Overrides", cache);
    const blogIdeas = await extractNamespaceEntries("plourenco.eu/Blog Ideas", cache);

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

    // 7. Generate YAML files
    const files = {};
    files["cv.yml"] = toYAML(cv);
    files["profile.yml"] = toYAML(profile);
    files["personal.yml"] = toYAML(personalPages);
    files["publication_overrides.yml"] = toYAML(pubOverridesData);

    // Manifest for the sync script
    files["manifest.json"] = JSON.stringify({
      exported_at: new Date().toISOString(),
      plugin_version: "0.1.0",
      website: logseq.settings?.websiteName || "plourenco.eu",
      files: Object.keys(files),
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
        personal_pages: Object.keys(personalPages).length,
        publication_overrides: Object.keys(pubOverridesData).length,
      },
    }, null, 2);

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

    // 8. Write files to sandbox storage
    const storage = logseq.Assets.makeSandboxStorage();

    for (const [filename, content] of Object.entries(files)) {
      const key = `${EXPORT_PREFIX}/${filename}`;
      await storage.setItem(key, content);
      console.log(`[al-folio] Wrote ${key}`);
    }

    const elapsed = Date.now() - startTime;
    const fileCount = Object.keys(files).length;
    const msg = `al-folio export complete: ${fileCount} files in ${elapsed}ms`;
    console.log(`[al-folio] ${msg}`);
    logseq.UI.showMsg(msg, "success");

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

  // Register command
  logseq.App.registerCommandPalette(
    { key: "alfolio-export", label: "Export to al-folio" },
    runExport
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
      default: "plourenco.eu",
    },
  ]);
}

logseq.ready(main).catch(console.error);
