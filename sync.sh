#!/usr/bin/env bash
# ============================================================================
# sync.sh — Copy exported files from Logseq plugin storage into the site repo
# ============================================================================
#
# Usage:
#   ./sync.sh --site /path/to/jekyll/site [--graph /path/to/logseq/graph]
#
# This script copies the export into the site's `_incoming/` directory and
# nowhere else. `_incoming/` holds the intermediate format verbatim; the site
# repo's own `bin/transform.py` is the only thing that writes `_data/`,
# `_posts/`, and `_bibliography/`. Writing those directly from here would
# overwrite generated files with a format the site does not read.
#
set -euo pipefail

GRAPH_DIR="${GRAPH_DIR:-$HOME/logseq}"
SITE_DIR="${SITE_DIR:-}"
PLUGIN_ID="logseq-alfolio-export"
EXPORT_PREFIX="_logseq_export"

usage() {
  cat >&2 <<EOF
Usage: $0 --site /path/to/jekyll/site [--graph /path/to/logseq/graph]

  --site   Path to the Jekyll site checkout. Required — there is no default,
           so a stray run cannot touch a real site repo by accident.
  --graph  Path to the Logseq graph. Defaults to \$GRAPH_DIR or ~/logseq.

Files are copied into <site>/_incoming/ only.
EOF
}

# ============================================================================
# Parse arguments
# ============================================================================
require_value() {
  # $1 = flag name, $2 = number of args remaining including the flag itself.
  if [ "$2" -lt 2 ]; then
    echo "❌ $1 requires a path." >&2
    usage
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --graph) require_value --graph $#; GRAPH_DIR="$2"; shift 2 ;;
    --site)  require_value --site  $#; SITE_DIR="$2";  shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$SITE_DIR" ]; then
  echo "❌ No site directory given. Pass --site or set SITE_DIR." >&2
  usage
  exit 2
fi

if [ ! -d "$SITE_DIR" ]; then
  echo "❌ Site directory does not exist: $SITE_DIR" >&2
  exit 2
fi

# ============================================================================
# Locate export directory
# ============================================================================
EXPORT_DIR="$GRAPH_DIR/.logseq/plugins/storages/$PLUGIN_ID/$EXPORT_PREFIX"

if [ ! -d "$EXPORT_DIR" ]; then
  echo "❌ Export directory not found: $EXPORT_DIR" >&2
  echo "   Have you run the export from Logseq?" >&2
  exit 1
fi

if [ ! -f "$EXPORT_DIR/manifest.json" ]; then
  echo "❌ No manifest.json found. Export may be incomplete." >&2
  exit 1
fi

INCOMING_DIR="$SITE_DIR/_incoming"

echo "📦 Syncing from: $EXPORT_DIR"
echo "📂 To:           $INCOMING_DIR"
echo ""

mkdir -p "$INCOMING_DIR"

# ============================================================================
# Copy data files
# ============================================================================
for f in cv.yml profile.yml personal.yml publication_overrides.yml; do
  if [ -f "$EXPORT_DIR/$f" ]; then
    cp "$EXPORT_DIR/$f" "$INCOMING_DIR/$f"
    echo "  ✅ $f → _incoming/$f"
  fi
done

# The manifest keeps its name: the transform reads _incoming/manifest.json.
cp "$EXPORT_DIR/manifest.json" "$INCOMING_DIR/manifest.json"
echo "  ✅ manifest.json → _incoming/manifest.json"

# ============================================================================
# Copy blog posts
# ============================================================================
if [ -d "$EXPORT_DIR/blog" ]; then
  mkdir -p "$INCOMING_DIR/blog"
  for f in "$EXPORT_DIR/blog/"*.md; do
    [ -f "$f" ] || continue
    cp "$f" "$INCOMING_DIR/blog/$(basename "$f")"
    echo "  ✅ blog/$(basename "$f") → _incoming/blog/$(basename "$f")"
  done
fi

echo ""

# ============================================================================
# Show export summary
#
# Cosmetic only, and deliberately not allowed to fail the run: every file has
# already been copied by this point, so a manifest this cannot parse must not
# turn a successful sync into a non-zero exit for whatever is wrapping us.
# Validating the manifest's contents is a separate job from copying it.
# ============================================================================
if command -v python3 &>/dev/null; then
  if ! python3 -c "
import json
with open('$EXPORT_DIR/manifest.json') as f:
    m = json.load(f)
print(f\"Export from: {m.get('exported_at', 'unknown')}\")
print('Counts:')
for k, v in m.get('counts', {}).items():
    print(f'  {k}: {v}')
" 2>/dev/null; then
    echo "⚠️  Could not read the manifest summary — manifest.json may be malformed." >&2
    echo "   The files above were still copied." >&2
  fi
fi

echo ""
echo "✅ Sync complete. Review the diff in $INCOMING_DIR, commit it, then run"
echo "   the site's transform to regenerate _data/ and _posts/."
