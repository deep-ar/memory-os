#!/bin/sh
set -eu

backup_dir=/backups
source_rdb=/source/dump.rdb
interval_seconds="${MEMORYOS_BACKUP_INTERVAL_SECONDS:-86400}"
retention_days="${MEMORYOS_BACKUP_RETENTION_DAYS:-14}"
retry_seconds="${MEMORYOS_BACKUP_RETRY_SECONDS:-5}"

mkdir -p "$backup_dir"

while true; do
  if ! redis-cli -h falkordb PING >/dev/null 2>&1; then
    echo "MemoryOS backup is waiting for FalkorDB at falkordb:6379" >&2
    sleep "$retry_seconds"
    continue
  fi

  if ! redis-cli -h falkordb SAVE >/dev/null; then
    echo "MemoryOS backup could not create an RDB snapshot; retrying" >&2
    sleep "$retry_seconds"
    continue
  fi
  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  snapshot="$backup_dir/memoryos-$stamp.rdb"
  temporary="$snapshot.tmp"
  cp "$source_rdb" "$temporary"
  mv "$temporary" "$snapshot"
  sha256="$(sha256sum "$snapshot" | awk '{print $1}')"
  bytes="$(wc -c < "$snapshot" | tr -d ' ')"
  printf '{\n  "format": "memoryos-falkordb-rdb-v1",\n  "createdAt": "%s",\n  "sha256": "%s",\n  "bytes": %s,\n  "snapshot": "%s"\n}\n' \
    "$created_at" "$sha256" "$bytes" "$(basename "$snapshot")" > "$snapshot.manifest.json"
  find "$backup_dir" -type f -mtime "+$retention_days" -delete
  sleep "$interval_seconds"
done
