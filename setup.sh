#!/usr/bin/env bash
#
# Prepare a host to run Anico: the data directory with an owner the container
# can actually write as, and a .env to fill in. Safe to re-run.
#
# The image runs as a non-root user (uid 1000). A bind mount keeps the host
# directory's ownership rather than the image's, so a directory created by root
# leaves the server unable to write its own database. That is the whole reason
# this script exists.

set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

DATA_DIR=${DATA_DIR:-./anico-data}
FALLBACK_UID=1000

say()  { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
warn() { printf '  \033[33mnote\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31merror\033[0m %s\n' "$*" >&2; exit 1; }

echo
echo "Anico setup"
echo

# --- prerequisites --------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."
docker compose version >/dev/null 2>&1 \
  || die "the docker compose plugin is missing. Install docker-compose-plugin."
docker info >/dev/null 2>&1 \
  || die "cannot talk to the Docker daemon. Is it running, and is your user in the docker group?"
ok "docker and the compose plugin are available"

# --- .env -----------------------------------------------------------------
if [ -f .env ]; then
  ok ".env already exists, leaving it alone"
else
  [ -f .env.example ] || die ".env.example is missing; run this from a checkout."
  cp .env.example .env
  ok "created .env from .env.example"
  say "nothing needs editing to start; it holds optional overrides"
fi

# --- which uid does the image run as? -------------------------------------
# Only set in .env when pinning a tag; otherwise compose's default applies.
DEFAULT_IMAGE=ghcr.io/rakkenti/anico:latest
IMAGE=$(grep -E '^[[:space:]]*ANICO_IMAGE=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' " || true)
IMAGE=${IMAGE:-$DEFAULT_IMAGE}
RUN_UID=""
if [ -n "$IMAGE" ] && docker image inspect "$IMAGE" >/dev/null 2>&1; then
  # Ask the image itself rather than trusting a number in a comment.
  RUN_UID=$(docker run --rm --entrypoint id "$IMAGE" -u 2>/dev/null || true)
fi
if [ -z "$RUN_UID" ]; then
  RUN_UID=$FALLBACK_UID
  say "image not pulled yet; assuming it runs as uid $RUN_UID"
else
  ok "image runs as uid $RUN_UID"
fi

# --- data directory -------------------------------------------------------
mkdir -p "$DATA_DIR"
CURRENT_UID=$(stat -c '%u' "$DATA_DIR")

if [ "$CURRENT_UID" = "$RUN_UID" ]; then
  ok "$DATA_DIR is already owned by uid $RUN_UID"
elif [ "$(id -u)" = "0" ]; then
  chown -R "$RUN_UID:$RUN_UID" "$DATA_DIR"
  ok "set $DATA_DIR owner to uid $RUN_UID"
elif [ "$(id -u)" = "$RUN_UID" ]; then
  ok "$DATA_DIR is yours and you are uid $RUN_UID; nothing to change"
elif command -v sudo >/dev/null 2>&1; then
  say "$DATA_DIR is owned by uid $CURRENT_UID, the container needs $RUN_UID"
  sudo chown -R "$RUN_UID:$RUN_UID" "$DATA_DIR"
  ok "set $DATA_DIR owner to uid $RUN_UID"
else
  die "$DATA_DIR must be owned by uid $RUN_UID. Run: chown -R $RUN_UID:$RUN_UID $DATA_DIR"
fi

chmod 750 "$DATA_DIR"
ok "$DATA_DIR is ready ($(du -sh "$DATA_DIR" 2>/dev/null | cut -f1) in use)"

# --- what to do next ------------------------------------------------------
# install.sh starts the container itself and prints its own next steps, so it
# silences this block rather than having the two of them disagree.
if [ "${ANICO_NEXT:-1}" = "0" ]; then
  exit 0
fi

cat <<'NEXT'

Next:

  1. Start it              docker compose up -d
  2. Watch the first boot  docker compose logs -f anico
  3. Open the instance and create the first account. It becomes the admin.
     Do this before the hostname is reachable from the internet: on an empty
     database the first account to register wins.

The catalog fills in the background over about 85 minutes and resumes if you
restart. You can play immediately; early rolls just draw from a smaller pool.

NEXT
