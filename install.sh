#!/usr/bin/env bash
#
# One command to stand up an Anico instance on the machine you are sitting at.
#
#   curl -fsSL https://raw.githubusercontent.com/RakkenTi/anico/master/install.sh | bash
#
# - Fetches the compose file
# - Prepares the data directory, this is important to prevent database permission issues.
# - Starts the container
set -euo pipefail

REPO=${ANICO_REPO:-RakkenTi/anico}
REF=${ANICO_REF:-master}
BASE=${ANICO_BASE_URL:-https://raw.githubusercontent.com/$REPO/$REF}
DIR=${ANICO_DIR:-anico}
PORT=${ANICO_PORT:-8080}

say()  { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$*"; }
die()  { printf '\n\033[31merror\033[0m %s\n' "$*" >&2; exit 1; }

echo
echo "Anico installer"
echo

# preqreq
command -v curl >/dev/null 2>&1 || die "curl is not installed."
command -v docker >/dev/null 2>&1 || die "docker is not installed or not on PATH."
docker compose version >/dev/null 2>&1 \
  || die "the docker compose plugin is missing. Install docker-compose-plugin."
docker info >/dev/null 2>&1 \
  || die "cannot talk to the Docker daemon. Is it running, and is your user in the docker group?"
ok "docker and the compose plugin are available"

mkdir -p "$DIR"
cd "$DIR"

for file in docker-compose.yml .env.example setup.sh Caddyfile.example; do
  curl -fsSL "$BASE/$file" -o "$file" || die "could not download $file from $BASE"
done
chmod +x setup.sh
ok "fetched the compose file and helpers into $(pwd)"

ANICO_NEXT=0 ./setup.sh

docker compose up -d
ok "started"

cat <<NEXT

Open http://localhost:$PORT and create the first account. It becomes the admin.

Do that before the port is reachable from anywhere else; as the first account to register becomes admin!

  Logs      cd $(pwd) && docker compose logs -f anico
  Stop      cd $(pwd) && docker compose down
  Data      $(pwd)/anico-data

The character catalog fills in the background over a few hours and resumes if
you restart.

NEXT
