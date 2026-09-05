#!/usr/bin/env bash
#
# Strum Fighter — installer for the feedBack plugin.
#
# Installing a feedBack plugin by hand has three traps, and this script exists
# to remove all three:
#
#   1. The directory name must equal the manifest `id` EXACTLY — strum_fighter,
#      not the repository name and not what GitHub's zip unpacks to. Get it
#      wrong and the host silently ignores the plugin: no error, it simply is
#      not there.
#   2. An AppImage is a read-only mount, so the plugin has to live outside it
#      and be pointed at with FEEDBACK_PLUGINS_DIR.
#   3. That variable has to be set for the feedBack process, which a desktop
#      icon will not do — hence the launcher this writes for you.
#
# Re-running it updates an existing install rather than complaining.
#
# Usage:
#   ./install.sh [--branch NAME] [--dir PATH] [--appimage PATH] [--desktop]
#
#   --branch NAME     branch to install from (default: main)
#   --dir PATH        plugins directory (default: $XDG_DATA_HOME/feedback/plugins)
#   --appimage PATH   your feedBack AppImage; autodetected when omitted
#   --desktop         also write a desktop entry so you can launch by clicking
#
# AGPL-3.0-only, same as the rest of the plugin.

set -euo pipefail

REPO_URL="https://github.com/charjonn/feedBack-plugin-strum-fighter.git"
PLUGIN_ID="strum_fighter"
BRANCH="main"
PLUGINS_DIR="${FEEDBACK_PLUGINS_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/feedback/plugins}"
APPIMAGE=""
WRITE_DESKTOP=0

say()  { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31mx %s\033[0m\n' "$*" >&2; exit 1; }

usage() { sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

while [ $# -gt 0 ]; do
  case "$1" in
    --branch)   BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    --dir)      PLUGINS_DIR="${2:?--dir needs a value}"; shift 2 ;;
    --appimage) APPIMAGE="${2:?--appimage needs a value}"; shift 2 ;;
    --desktop)  WRITE_DESKTOP=1; shift ;;
    -h|--help)  usage ;;
    *)          die "Unknown option: $1  (try --help)" ;;
  esac
done

command -v git >/dev/null 2>&1 || die \
  "git is not installed. Either install it, or download the branch zip from
   GitHub, unpack it, and rename the unpacked folder to '$PLUGIN_ID' inside
   your plugins directory."

# ── 1. Fetch or update the plugin, under the one name the host will accept ──
TARGET="$PLUGINS_DIR/$PLUGIN_ID"
step "Installing $PLUGIN_ID into $PLUGINS_DIR"
mkdir -p "$PLUGINS_DIR"

if [ -d "$TARGET/.git" ]; then
  say "Already installed — updating."
  git -C "$TARGET" remote set-url origin "$REPO_URL"
  git -C "$TARGET" fetch --quiet origin "$BRANCH"
  # Hard reset rather than pull: this directory is a deployment, not a
  # workspace, and a half-merged plugin is worse than a replaced one.
  git -C "$TARGET" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
  git -C "$TARGET" reset --hard --quiet "origin/$BRANCH"
elif [ -e "$TARGET" ]; then
  die "$TARGET exists but is not a git checkout. Move it aside and re-run."
else
  git clone --quiet --branch "$BRANCH" --depth 1 "$REPO_URL" "$TARGET"
fi

# ── 2. Prove it landed correctly, since the failure mode is silence ──
[ -f "$TARGET/plugin.json" ] || die "No plugin.json in $TARGET — install failed."
MANIFEST_ID="$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TARGET/plugin.json" | head -n1)"
[ "$MANIFEST_ID" = "$PLUGIN_ID" ] || die \
  "Manifest id is '$MANIFEST_ID' but the directory is '$PLUGIN_ID'. The host
   loads a plugin only when those match exactly."
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TARGET/plugin.json" | head -n1)"
say "Installed $PLUGIN_ID ${VERSION:-?} ($BRANCH) at $TARGET"

# ── 3. Find the AppImage, so the launcher can point at something real ──
if [ -z "$APPIMAGE" ]; then
  step "Looking for your feedBack AppImage"
  # Newest first: if several builds are lying around, the recent one is
  # almost certainly the one being used.
  CANDIDATES="$(
    for d in "$HOME/Downloads" "$HOME/Applications" "$HOME/.local/bin" "$HOME/Apps" "$HOME" /opt; do
      [ -d "$d" ] || continue
      find "$d" -maxdepth 2 -iname '*feedback*.AppImage' -type f 2>/dev/null || true
    done | sort -u
  )"
  COUNT="$(printf '%s' "$CANDIDATES" | grep -c . || true)"
  if [ "$COUNT" -eq 0 ]; then
    warn "None found. Pass --appimage /path/to/feedBack.AppImage to get a launcher."
  else
    APPIMAGE="$(printf '%s\n' "$CANDIDATES" | xargs -d '\n' ls -1t 2>/dev/null | head -n1)"
    [ -n "$APPIMAGE" ] || APPIMAGE="$(printf '%s\n' "$CANDIDATES" | head -n1)"
    if [ "$COUNT" -gt 1 ]; then
      warn "Found $COUNT AppImages; using the newest. Override with --appimage."
      printf '%s\n' "$CANDIDATES" | sed 's/^/    /' >&2
    fi
    say "Using $APPIMAGE"
  fi
fi

# ── 4. A launcher that sets the variable feedBack needs ──
LAUNCHER="$PLUGINS_DIR/start-feedback.sh"
if [ -n "$APPIMAGE" ]; then
  [ -x "$APPIMAGE" ] || { chmod +x "$APPIMAGE" 2>/dev/null || warn "Could not make $APPIMAGE executable."; }
  cat > "$LAUNCHER" <<LAUNCH
#!/usr/bin/env bash
# Written by the Strum Fighter installer. Starts feedBack with your plugins
# directory attached; a desktop icon would not pass this variable through.
exec env FEEDBACK_PLUGINS_DIR="$PLUGINS_DIR" "$APPIMAGE" "\$@"
LAUNCH
  chmod +x "$LAUNCHER"
  say "Launcher written to $LAUNCHER"
fi

# ── 5. Optionally, something clickable ──
if [ "$WRITE_DESKTOP" -eq 1 ]; then
  if [ -z "$APPIMAGE" ]; then
    warn "Skipping the desktop entry: no AppImage to launch."
  else
    APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
    mkdir -p "$APPS_DIR"
    cat > "$APPS_DIR/feedback-plugins.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=feedBack (with plugins)
Comment=feedBack, started with your plugins directory attached
Exec=$LAUNCHER
Terminal=false
Categories=AudioVideo;Audio;
DESKTOP
    say "Desktop entry written to $APPS_DIR/feedback-plugins.desktop"
  fi
fi

# ── 6. What to do next ──
step "Done. To play:"
if [ -n "$APPIMAGE" ]; then
  say "  $LAUNCHER"
else
  say "  FEEDBACK_PLUGINS_DIR=\"$PLUGINS_DIR\" /path/to/feedBack.AppImage"
fi
say ""
say "Then open Minigames -> Strum Fighter."
say "To update later, run this script again."
say ""
say "If Strum Fighter is missing from the list, the plugins directory is not"
say "reaching feedBack — start it with the launcher above, not the app icon."
say "If it opens but says it needs the desktop app, your build has no native"
say "audio engine; chord detection cannot run there."
