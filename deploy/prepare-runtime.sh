#!/usr/bin/env bash
set -euo pipefail

app_dir="${1:-/www/wwwroot/campuswall-react}"
backend_dir="${app_dir}/backend"
runtime_user="campuswall"
runtime_group="campuswall"

if [[ ! -d "${backend_dir}" ]]; then
  printf 'Backend directory not found: %s\n' "${backend_dir}" >&2
  exit 1
fi

if ! id -u "${runtime_user}" >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/campuswall --create-home --shell /usr/sbin/nologin "${runtime_user}"
fi

runtime_dirs=(
  "static/uploads"
  "static/chunks"
  "static/avatars"
  "static/tiny_files"
  "static/messages"
  "static/apps/icons"
  "help"
  "logs"
)

for relative_dir in "${runtime_dirs[@]}"; do
  install -d -m 0750 -o "${runtime_user}" -g "${runtime_group}" "${backend_dir}/${relative_dir}"
  chown -R "${runtime_user}:${runtime_group}" "${backend_dir}/${relative_dir}"
done

ensure_json_file() {
  local path="$1"
  local initial_value="$2"
  if [[ ! -e "${path}" ]]; then
    install -m 0640 -o "${runtime_user}" -g "${runtime_group}" /dev/null "${path}"
    printf '%s\n' "${initial_value}" > "${path}"
  fi
  chown "${runtime_user}:${runtime_group}" "${path}"
  chmod 0640 "${path}"
}

ensure_json_file "${backend_dir}/managers.json" '{}'
ensure_json_file "${backend_dir}/admin_log.json" '[]'
ensure_json_file "${backend_dir}/manage_message.json" '{"approved":{}}'
ensure_json_file "${backend_dir}/static/notice.json" '[]'
