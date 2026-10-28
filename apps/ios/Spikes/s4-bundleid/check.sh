#!/bin/zsh
# Spike S4: read-only App Store Connect lookup of bundle ids co.xanom.flint and co.xanom.flint.ios.
# Needs the 1Password desktop app unlocked and approving the CLI prompt. Prints identifier/platform/name only; never keys or tokens.
set -euo pipefail
OPA=E3OXZANXQRDOBNXQMPXZ6YBHTY; ITEM=a2ahwayupzf5uuj5u5famnyx4y
ASC_PY="${ASC_PY:-$HOME/Documents/GitHub/sheafnote/scripts/asc.py}"
D="$(mktemp -d)"; mkdir "$D/asc"; trap 'rm -rf "${D:?}"' EXIT
op --account $OPA signin >/dev/null
KEY_ID="$(op --account $OPA item get $ITEM --fields 'label=Key ID' --reveal)"
printf %s "$KEY_ID" > "$D/asc/keyid"
op --account $OPA item get $ITEM --fields 'label=issuer id' --reveal | tr -d '[:space:]' > "$D/asc/issuer"
op --account $OPA read "op://Private/$ITEM/AuthKey_${KEY_ID}.p8" --out-file "$D/asc/AuthKey_${KEY_ID}.p8" >/dev/null
for id in co.xanom.flint co.xanom.flint.ios; do
  ASC_KEY_DIR="$D/asc" python3 -I "$ASC_PY" GET "/v1/bundleIds?filter%5Bidentifier%5D=$id" | python3 -I -c "
import json,sys
r=json.load(sys.stdin); rows=[(d['attributes']['identifier'],d['attributes']['platform'],d['attributes']['name']) for d in r['data'].get('data',[])]
print('$id', 'HTTP', r['status'], rows or 'not registered')"
done
