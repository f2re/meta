#!/usr/bin/env bash
set -Eeuo pipefail
OUT_DIR="${1:-release-signing-key}"
command -v openssl >/dev/null 2>&1 || { echo "Не найден openssl" >&2; exit 2; }
mkdir -p "$OUT_DIR"
umask 077
PRIVATE="$OUT_DIR/release-ed25519-private.pem"
PUBLIC="$OUT_DIR/release-ed25519-public.pem"
[[ ! -e "$PRIVATE" && ! -e "$PUBLIC" ]] || { echo "Ключи уже существуют: $OUT_DIR" >&2; exit 2; }
openssl genpkey -algorithm Ed25519 -out "$PRIVATE"
openssl pkey -in "$PRIVATE" -pubout -out "$PUBLIC"
KEY_ID="$(openssl pkey -in "$PRIVATE" -pubout -outform DER | sha256sum | awk '{print substr($1,1,32)}')"
printf '%s\n' "$KEY_ID" > "$OUT_DIR/key-id.txt"
chmod 0600 "$PRIVATE"
chmod 0644 "$PUBLIC" "$OUT_DIR/key-id.txt"
printf 'Создан release keyId=%s\nПубличный ключ: %s\nПриватный ключ: %s (не переносить на target)\n' "$KEY_ID" "$PUBLIC" "$PRIVATE"
