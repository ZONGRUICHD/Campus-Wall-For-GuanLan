#!/bin/sh
set -eu

umask 027

data_root=/var/lib/campus-wall

mkdir -p \
  "${data_root}/static/uploads" \
  "${data_root}/static/chunks" \
  "${data_root}/static/avatars" \
  "${data_root}/static/tiny_files" \
  "${data_root}/static/apps/icons" \
  "${data_root}/help" \
  "${data_root}/logs"

exec "$@"
