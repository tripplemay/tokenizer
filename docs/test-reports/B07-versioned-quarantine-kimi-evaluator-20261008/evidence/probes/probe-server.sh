#!/bin/bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
# Independent server-side probes: partial ACK admission, legacy whole-batch,
# envelope failures, write-free all-rejected, empty heartbeat.
set -u
BASE=http://localhost:3999
TOK="tok_eval_secret_0123456789abcdef"
AUTH="authorization: Bearer $TOK"
HDR_PARTIAL="x-tokenizer-batch-protocol: usage-partial-v1"
PSQL="psql -h /tmp/b07-eval -p 55432 -U postgres -d tokenizer_eval -Atc"
PASS=0; FAIL=0
ok()  { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }
check() { # name expected actual
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected=[$2] actual=[$3])"; fi
}

GOOD_A='{"source":"aider","sourceEventId":"probe-a","occurredAt":"2026-10-08T00:00:00.000Z","inputTokens":10,"outputTokens":5,"totalTokens":15}'
GOOD_B='{"source":"codex","sourceEventId":"probe-b","occurredAt":"2026-10-08T00:00:01.000Z","inputTokens":1,"outputTokens":2,"totalTokens":3}'
BAD_SRC='{"source":"not-a-source","sourceEventId":"probe-x","occurredAt":"2026-10-08T00:00:02.000Z"}'
BAD_RAW='{"source":"aider","sourceEventId":"probe-y","occurredAt":"2026-10-08T00:00:03.000Z","rawJson":{"deep":{"x":1}},"inputTokens":-5}'
DEV='"device":{"id":"dev_eval0001","name":"eval-host"}'

echo "=== P1: partial batch 3 rows (good,bad-source,good) ==="
BODY="{$DEV,\"timezone\":\"UTC\",\"events\":[$GOOD_A,$BAD_SRC,$GOOD_B]}"
CODE=$(curl -s -o /tmp/b07-eval/resp.json -w "%{http_code}" "$BASE/api/usage/events/batch" -X POST -H "$AUTH" -H "$HDR_PARTIAL" -H "content-type: application/json" --data-raw "$BODY"); JSON=$(cat /tmp/b07-eval/resp.json)
echo "HTTP $CODE $JSON"
check "P1 http" 200 "$CODE"
echo "$JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ok=True
ok &= d.get('protocol')=='usage-partial-v1'
acc=d.get('accepted'); rej=d.get('rejected')
ok &= isinstance(acc,list) and isinstance(rej,list)
ok &= [a['row'] for a in acc]==[0,2]
ok &= acc[0]['source']=='aider' and acc[0]['sourceEventId']=='probe-a'
ok &= acc[1]['source']=='codex' and acc[1]['sourceEventId']=='probe-b'
ok &= rej==[{'row':1,'code':'invalid_event'}]
ok &= d.get('received')==2
print('P1-STRUCT-' + ('PASS' if ok else 'FAIL: '+json.dumps(d)))
"
NDB=$($PSQL "select count(*) from \"UsageEvent\" where \"sourceEventId\" in ('probe-a','probe-b','probe-x');")
check "P1 db rows (only 2 good admitted)" 2 "$NDB"
NBAD=$($PSQL "select count(*) from \"UsageEvent\" where \"sourceEventId\"='probe-x';")
check "P1 bad row absent" 0 "$NBAD"

echo "=== P2: all-rejected partial batch is write-free ==="
TZ_BEFORE=$($PSQL "select coalesce(timezone,'<null>') from \"User\" where email='eval@example.com';")
LSA_BEFORE=$($PSQL "select coalesce(\"lastSyncAt\"::text,'<null>') from \"Device\" where id='dev_eval0001';")
BODY="{$DEV,\"timezone\":\"Pacific/Auckland\",\"events\":[$BAD_SRC,$BAD_RAW]}"
CODE=$(curl -s -o /tmp/b07-eval/resp.json -w "%{http_code}" "$BASE/api/usage/events/batch" -X POST -H "$AUTH" -H "$HDR_PARTIAL" -H "content-type: application/json" --data-raw "$BODY"); JSON=$(cat /tmp/b07-eval/resp.json)
echo "HTTP $CODE $JSON"
check "P2 http" 200 "$CODE"
echo "$JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ok = d.get('accepted')==[] and len(d.get('rejected',[]))==2 and d.get('received')==0
ok &= d.get('inserted')==0 and d.get('duplicates')==0
print('P2-STRUCT-' + ('PASS' if ok else 'FAIL: '+json.dumps(d)))
"
TZ_AFTER=$($PSQL "select coalesce(timezone,'<null>') from \"User\" where email='eval@example.com';")
LSA_AFTER=$($PSQL "select coalesce(\"lastSyncAt\"::text,'<null>') from \"Device\" where id='dev_eval0001';")
check "P2 timezone untouched" "$TZ_BEFORE" "$TZ_AFTER"
check "P2 lastSyncAt untouched" "$LSA_BEFORE" "$LSA_AFTER"
NEV=$($PSQL "select count(*) from \"UsageEvent\" where \"sourceEventId\" in ('probe-x','probe-y');")
check "P2 no events written" 0 "$NEV"

echo "=== P3: valid empty partial batch keeps heartbeat (lastSyncAt updates) ==="
sleep 1
BODY="{$DEV,\"timezone\":\"UTC\",\"events\":[]}"
CODE=$(curl -s -o /tmp/b07-eval/resp.json -w "%{http_code}" "$BASE/api/usage/events/batch" -X POST -H "$AUTH" -H "$HDR_PARTIAL" -H "content-type: application/json" --data-raw "$BODY"); JSON=$(cat /tmp/b07-eval/resp.json)
echo "HTTP $CODE $JSON"
check "P3 http" 200 "$CODE"
echo "$JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
ok = d.get('accepted')==[] and d.get('rejected')==[] and d.get('received')==0 and d.get('protocol')=='usage-partial-v1'
print('P3-STRUCT-' + ('PASS' if ok else 'FAIL: '+json.dumps(d)))
"
LSA_HB=$($PSQL "select coalesce(\"lastSyncAt\"::text,'<null>') from \"Device\" where id='dev_eval0001';")
if [ "$LSA_HB" != "$LSA_BEFORE" ] && [ "$LSA_HB" != "<null>" ]; then ok "P3 empty batch heartbeat updated lastSyncAt ($LSA_HB)"; else bad "P3 heartbeat lastSyncAt ($LSA_HB vs $LSA_BEFORE)"; fi

echo "=== P4: legacy no-header batch with one bad row -> whole 400, zero writes ==="
BODY="{$DEV,\"timezone\":\"UTC\",\"events\":[$GOOD_A,$BAD_SRC]}"
CODE=$(curl -s -o /tmp/b07-eval/resp.json -w "%{http_code}" "$BASE/api/usage/events/batch" -X POST -H "$AUTH" -H "content-type: application/json" --data-raw "$BODY"); JSON=$(cat /tmp/b07-eval/resp.json)
echo "HTTP $CODE $JSON"
check "P4 http" 400 "$CODE"
check "P4 body" '{"error":"invalid batch request","code":"invalid_event","row":1}' "$JSON"
NA=$($PSQL "select count(*) from \"UsageEvent\" where \"sourceEventId\"='probe-a';")
check "P4 good row NOT written by legacy path" 1 "$NA"   # probe-a count stays 1 (from P1), not 2

echo "=== P5: partial header, envelope failure still whole-request 400 ==="
BODY="{$DEV,\"timezone\":\"Not/AZone\",\"events\":[$GOOD_A]}"
CODE=$(curl -s -o /tmp/b07-eval/resp.json -w "%{http_code}" "$BASE/api/usage/events/batch" -X POST -H "$AUTH" -H "$HDR_PARTIAL" -H "content-type: application/json" --data-raw "$BODY"); JSON=$(cat /tmp/b07-eval/resp.json)
echo "HTTP $CODE $JSON"
check "P5 http" 400 "$CODE"
check "P5 body" '{"error":"invalid batch request","code":"invalid_timezone"}' "$JSON"

echo "=== P6: device mismatch -> 403 ==="
BODY='{"device":{"id":"dev_other","name":"x"},"events":[]}'
CODE=$(curl -s -o /tmp/b07-eval/resp.json -w "%{http_code}" "$BASE/api/usage/events/batch" -X POST -H "$AUTH" -H "$HDR_PARTIAL" -H "content-type: application/json" --data-raw "$BODY")
check "P6 http" 403 "$CODE"

echo "=== P7: no auth -> 401 / bogus token -> 401 ==="
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/usage/events/batch" -X POST -H "$HDR_PARTIAL" -H "content-type: application/json" --data-raw '{}')
check "P7 no-auth" 401 "$RESP"
RESP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/usage/events/batch" -X POST -H "authorization: Bearer wrong" -H "$HDR_PARTIAL" -H "content-type: application/json" --data-raw '{}')
check "P7 bad-token" 401 "$RESP"

echo "=== P8: partial header, invalid_json structural poison locates row when possible ==="
# A row that violates boundedJson (NUL in string) inside an otherwise parseable JSON
POISON='{"source":"aider","sourceEventId":"probe-z","occurredAt":"2026-10-08T00:00:04.000Z"}'
BODY=$(printf '{%s,"events":[%s,%s]}' "$DEV" "$GOOD_B" "$POISON")
CODE=$(curl -s -o /tmp/b07-eval/resp.json -w "%{http_code}" "$BASE/api/usage/events/batch" -X POST -H "$AUTH" -H "$HDR_PARTIAL" -H "content-type: application/json" --data-raw "$BODY"); JSON=$(cat /tmp/b07-eval/resp.json)
echo "HTTP $CODE $JSON"
# boundedJson fails at root depth 32 check for that row -> rowless OR row-located invalid_json both 400
check "P8 http" 400 "$CODE"

echo "=== P9: oversized row count (201) -> batch_too_large even with partial header ==="
EVENTS=$(python3 -c "print(','.join(['{\"source\":\"aider\",\"sourceEventId\":\"bulk-%d\",\"occurredAt\":\"2026-10-08T00:01:00.000Z\"}'%i for i in range(201)]))")
BODY="{$DEV,\"events\":[$EVENTS]}"
CODE=$(curl -s -o /tmp/b07-eval/resp.json -w "%{http_code}" "$BASE/api/usage/events/batch" -X POST -H "$AUTH" -H "$HDR_PARTIAL" -H "content-type: application/json" --data-raw "$BODY"); JSON=$(cat /tmp/b07-eval/resp.json)
echo "HTTP $CODE $JSON"
check "P9 http" 400 "$CODE"
check "P9 body" '{"error":"invalid batch request","code":"batch_too_large"}' "$JSON"

echo
echo "SUMMARY pass=$PASS fail=$FAIL"
