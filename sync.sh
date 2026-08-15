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

if ! command -v python3 &>/dev/null; then
  echo "❌ python3 is required (to read the export manifest safely)." >&2
  exit 1
fi

echo "📦 Syncing from: $EXPORT_DIR"
echo "📂 To:           $INCOMING_DIR"
echo ""

mkdir -p "$INCOMING_DIR"

# ============================================================================
# Plan the sync
#
# What to copy comes from the NEW manifest, not from a glob: globbing the
# export directory would also pick up files left over from a previous run,
# which the destination would then reject as unlisted extras.
#
# What to delete comes from the PREVIOUS manifest in _incoming/ — exactly the
# paths the last export owned and this one no longer writes. _incoming/ is not
# exclusively ours (the site keeps README.md there, and papers.src.bib is
# staged by hand from Zotero), so clearing the directory is not an option.
# Anything we cannot account for is left alone.
# ============================================================================
PLAN="$(python3 - "$EXPORT_DIR" "$INCOMING_DIR" <<'PYEOF'
import json, os, sys

export_dir, incoming_dir = sys.argv[1], sys.argv[2]
out = []

def safe(rel):
    """Reject anything that could escape the directory we are writing into."""
    if not rel or os.path.isabs(rel) or rel.startswith("/"):
        return False
    parts = rel.replace("\\", "/").split("/")
    return ".." not in parts and "" not in parts

with open(os.path.join(export_dir, "manifest.json"), encoding="utf-8") as fh:
    new_manifest = json.load(fh)

# The manifest is the copy plan, so an export that does not list its own files
# cannot be synced. Exports before contract v1 are the likely cause; copying a
# guessed set would stage files the destination then rejects as unlisted.
if not isinstance(new_manifest.get("files"), list) or not new_manifest["files"]:
    sys.stderr.write(
        "manifest.json has no files list, so there is nothing to copy from.\n"
        "   Re-run the export with a current version of the plugin.\n"
    )
    raise SystemExit(1)

new_files = [f for f in new_manifest["files"] if f != "manifest.json"]
for rel in new_files:
    if not safe(rel):
        out.append(f"WARN\tmanifest lists an unsafe path, skipping: {rel!r}")
        continue
    out.append(f"COPY\t{rel}")

# A previous manifest we cannot read means "no previous export": prune nothing
# rather than guess. Deleting on a guess is unrecoverable; a stale file is not.
prev_path = os.path.join(incoming_dir, "manifest.json")
prev_files, reason = None, None
if not os.path.exists(prev_path):
    reason = "no previous manifest in _incoming/ — nothing to prune"
else:
    try:
        with open(prev_path, encoding="utf-8") as fh:
            prev = json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        reason = f"previous manifest is unreadable ({exc}) — pruning nothing"
    else:
        if prev.get("schema_version") != new_manifest.get("schema_version"):
            reason = (
                f"previous manifest declares schema_version "
                f"{prev.get('schema_version')!r} — pruning nothing"
            )
        elif not isinstance(prev.get("files"), list):
            reason = "previous manifest has no files list — pruning nothing"
        else:
            prev_files = prev["files"]

if prev_files is None:
    out.append(f"WARN\t{reason}")
else:
    keep = set(new_files) | {"manifest.json"}
    for rel in sorted(set(prev_files) - keep):
        if not safe(rel):
            out.append(f"WARN\tprevious manifest lists an unsafe path, skipping: {rel!r}")
            continue
        out.append(f"PRUNE\t{rel}")

print("\n".join(out))
PYEOF
)" || { echo "❌ Could not read $EXPORT_DIR/manifest.json — the export looks incomplete." >&2; exit 1; }

# ============================================================================
# Execute: copy, then prune, then the manifest LAST.
#
# The manifest is the commit point. Written first, a crash would leave it
# naming files that do not exist and destroy the only record of what the
# previous export owned, stranding stale files permanently. Written last, a
# crash leaves the previous manifest intact and re-running is still correct.
# ============================================================================
while IFS=$'\t' read -r action rel; do
  [ -n "${action:-}" ] || continue
  case "$action" in
    COPY)
      src="$EXPORT_DIR/$rel"
      if [ ! -f "$src" ]; then
        echo "❌ manifest lists $rel but it is not in the export directory." >&2
        echo "   Refusing to write a manifest that does not describe the copy." >&2
        exit 1
      fi
      mkdir -p "$(dirname "$INCOMING_DIR/$rel")"
      cp "$src" "$INCOMING_DIR/$rel"
      echo "  ✅ $rel → _incoming/$rel"
      ;;
    PRUNE)
      # Files only, never directories. An already-absent entry is not an error;
      # an empty directory left behind is harmless (the site's integrity check
      # only looks at files).
      if [ -f "$INCOMING_DIR/$rel" ]; then
        rm -f "$INCOMING_DIR/$rel"
        echo "  🗑  removed stale _incoming/$rel"
      fi
      ;;
    WARN)
      echo "  ⚠️  $rel" >&2
      ;;
  esac
done <<< "$PLAN"

cp "$EXPORT_DIR/manifest.json" "$INCOMING_DIR/manifest.json"
echo "  ✅ manifest.json → _incoming/manifest.json"

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
  # The path is passed as an argument rather than interpolated into the source,
  # so a graph directory containing a quote does not break the script.
  if ! python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    m = json.load(f)
print("Export from: {}".format(m.get("exported_at", "unknown")))
print("Counts:")
for k, v in m.get("counts", {}).items():
    print("  {}: {}".format(k, v))
' "$EXPORT_DIR/manifest.json" 2>/dev/null; then
    echo "⚠️  Could not read the manifest summary — manifest.json may be malformed." >&2
    echo "   The files above were still copied." >&2
  fi
fi

echo ""
echo "✅ Sync complete. Review the diff in $INCOMING_DIR, commit it, then run"
echo "   the site's transform to regenerate _data/ and _posts/."
