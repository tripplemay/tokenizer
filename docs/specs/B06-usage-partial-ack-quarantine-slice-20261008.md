# B06 usage partial ACK and quarantine slice

This candidate extends the bounded B06 usage endpoint and Agent. It does not
change quota ingestion or the B07 multi-writer outbox/cursor model.

## Wire contract

New Agents send `x-tokenizer-batch-protocol: usage-partial-v1`. A supporting
server validates the envelope, device and timezone before side effects, then
validates each usage row. Its HTTP 200 response adds:

```json
{
  "protocol": "usage-partial-v1",
  "accepted": [{ "row": 0, "source": "aider", "sourceEventId": "event-a" }],
  "rejected": [{ "row": 1, "code": "invalid_event" }]
}
```

`accepted` is an explicit ID ACK. `accepted` plus `rejected` must be a unique,
complete partition of the submitted row indices. The Agent checks every
accepted source and sourceEventId against its request and fails closed on a
missing, duplicate, out-of-range or forged entry. `received` must equal the
accepted count. Fixed rejection codes never echo row content.

The server writes only accepted rows. A partial request with no accepted rows
does not update timezone, device, token, projects, events, cache or pricing.
Envelope/device/timezone/body failures remain whole-request 400. Valid empty
batches keep the established lastSyncAt heartbeat behavior.

## Compatibility and rollout

- Old Agents omit the header and retain the B06 whole-batch 400/no-write
  contract byte-for-byte. Additive response fields are never sent to them.
- A new Agent talking to the immediately preceding B06 server recognizes its
  structured 400 `{code,row}`, quarantines that one permanent row and retries
  the good subset immediately. Permanent 400/401/403 responses are not put
  through the 5s/15s transient retry loop.
- A legacy success response without partial fields is treated as a full-batch
  ACK. Therefore the bounded B06 server must be deployed before this Agent;
  pre-B06 servers did not reliably reject poison rows.
- 408/425/429/5xx and transport failures keep the existing two bounded retries.

## Durable ordering

Rejected rows are privacy-minimized and git-credential-sanitized into
`~/.tokenizer/rejected-usage.jsonl`, keyed by source plus sourceEventId. The
quarantine uses the same cross-process lock and atomic rename mechanism as
other Agent state.

For a partial response the Agent performs:

1. atomically merge rejected rows into quarantine;
2. checkpoint the active queue with all resolved accepted/rejected IDs removed;
3. continue with the next live batch.

If step 1 fails, the active queue is unchanged. If the process stops between
steps 1 and 2, the original queue is replayed: accepted rows deduplicate on the
server and rejected rows merge idempotently. Thus no good row is silently lost
and one permanent row cannot retry forever or pin its neighbours.

`tokenizer status` reports the quarantine path/count (or unreadable state).
There is deliberately no automatic replay: repair and replay require a future
explicit CLI with revalidation so malformed data is not silently reintroduced.

## Boundaries

- Queue/quarantine updates are crash-safe but not one transaction. B07 still
  owns whole-run mutual exclusion, concurrent collectors and ID-ACK queue
  reconciliation across multiple writers.
- Quota snapshots still use whole-batch behavior; this slice targets the
  durable usage queue used by `sync`, `run` and the background Agent.
- Operational failures after valid-row admission retain existing B07 concerns;
  server-side event identity makes request replay idempotent but does not make
  all downstream side effects transactional.
- This is a candidate implementation, not a release. It still needs independent
  evaluation, exact-SHA native CI and the normal release/deployment gates.
