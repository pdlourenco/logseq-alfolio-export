#!/usr/bin/env bash
# ============================================================================
# sync.sh — Copy exported YAML from Logseq plugin storage to Jekyll site
# ============================================================================
#
# Usage:
#   ./sync.sh [--graph /path/to/logseq/graph] [--site /path/to/jekyll/site]
#
# Defaults (configure these or pass as arguments):
GRAPH_DIR="${GRAPH_DIR:-$HOME/logseq}"
SITE_DIR="${SITE_DIR:-$HOME/pdlourenco.github.io}"
PLUGIN_ID="logseq-alfolio-export"
EXPORT_PREFIX="_logseq_export"

# ============================================================================
# Parse arguments
# ============================================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --graph) GRAPH_DIR="$2"; shift 2 ;;
    --site)  SITE_DIR="$2";  shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ============================================================================
# Locate export directory
# ============================================================================
# Plugin sandbox storage lives at:
#   <graph>/.logseq/plugins/storages/<plugin-id>/
EXPORT_DIR="$GRAPH_DIR/.logseq/plugins/storages/$PLUGIN_ID/$EXPORT_PREFIX"

if [ ! -d "$EXPORT_DIR" ]; then
  echo "❌ Export directory not found: $EXPORT_DIR"
  echo "   Have you run the export from Logseq?"
  exit 1
fi

if [ ! -f "$EXPORT_DIR/manifest.json" ]; then
  echo "❌ No manifest.json found. Export may be incomplete."
  exit 1
fi

echo "📦 Syncing from: $EXPORT_DIR"
echo "📂 To site:      $SITE_DIR"
echo ""

# ============================================================================
# Copy data files
# ============================================================================
DATA_DIR="$SITE_DIR/_data"
mkdir -p "$DATA_DIR"

for f in cv.yml profile.yml personal.yml publication_overrides.yml; do
  if [ -f "$EXPORT_DIR/$f" ]; then
    cp "$EXPORT_DIR/$f" "$DATA_DIR/$f"
    echo "  ✅ $f → _data/$f"
  fi
done

# Copy manifest for reference
cp "$EXPORT_DIR/manifest.json" "$DATA_DIR/export_manifest.json"
echo "  ✅ manifest.json → _data/export_manifest.json"

# ============================================================================
# Copy blog posts
# ============================================================================
if [ -d "$EXPORT_DIR/blog" ]; then
  POSTS_DIR="$SITE_DIR/_posts"
  mkdir -p "$POSTS_DIR"
  for f in "$EXPORT_DIR/blog/"*.md; do
    [ -f "$f" ] || continue
    cp "$f" "$POSTS_DIR/$(basename "$f")"
    echo "  ✅ blog/$(basename "$f") → _posts/$(basename "$f")"
  done
fi

echo ""

# ============================================================================
# Show export summary
# ============================================================================
if command -v python3 &>/dev/null; then
  python3 -c "
import json, sys
with open('$EXPORT_DIR/manifest.json') as f:
    m = json.load(f)
print(f\"Export from: {m['exported_at']}\")
print(f\"Counts:\")
for k, v in m.get('counts', {}).items():
    print(f\"  {k}: {v}\")
"
fi

echo ""
echo "✅ Sync complete. Run 'cd $SITE_DIR && bundle exec jekyll serve' to preview."
