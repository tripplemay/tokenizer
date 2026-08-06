-- Canonicalize historical Codex cumulative snapshots. This mirrors
-- src/shared/codex-usage.ts so old agents converge on the same identity as
-- the fixed parser. Invalid sessions or rows without total_token_usage are
-- intentionally left untouched.
CREATE OR REPLACE FUNCTION pg_temp.codex_counter(raw jsonb, key text)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  value numeric;
BEGIN
  IF raw IS NULL OR jsonb_typeof(raw -> key) IS NULL OR jsonb_typeof(raw -> key) NOT IN ('number', 'string') THEN
    RETURN 0;
  END IF;
  BEGIN
    value := (raw ->> key)::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN 0;
  END;
  IF value IS NULL OR value <= 0 THEN
    RETURN 0;
  END IF;
  IF value >= 9223372036854775807::numeric THEN
    RETURN 9223372036854775807;
  END IF;
  RETURN trunc(value)::bigint;
END;
$$;

DROP TABLE IF EXISTS pg_temp."_CodexUsageCanonical";
CREATE TEMP TABLE "_CodexUsageCanonical" AS
SELECT
  ranked."id",
  ranked."deviceId",
  ranked."canonicalId",
  ranked."rank"
FROM (
  SELECT
    ue."id",
    ue."deviceId",
    'codex:v2:' || ue."sessionId" || ':' ||
      pg_temp.codex_counter(snapshot.total, 'input_tokens') || ':' ||
      pg_temp.codex_counter(snapshot.total, 'cached_input_tokens') || ':' ||
      pg_temp.codex_counter(snapshot.total, 'cache_write_input_tokens') || ':' ||
      pg_temp.codex_counter(snapshot.total, 'output_tokens') || ':' ||
      pg_temp.codex_counter(snapshot.total, 'reasoning_output_tokens') || ':' ||
      pg_temp.codex_counter(snapshot.total, 'total_tokens') AS "canonicalId",
    ROW_NUMBER() OVER (
      PARTITION BY ue."deviceId",
        'codex:v2:' || ue."sessionId" || ':' ||
          pg_temp.codex_counter(snapshot.total, 'input_tokens') || ':' ||
          pg_temp.codex_counter(snapshot.total, 'cached_input_tokens') || ':' ||
          pg_temp.codex_counter(snapshot.total, 'cache_write_input_tokens') || ':' ||
          pg_temp.codex_counter(snapshot.total, 'output_tokens') || ':' ||
          pg_temp.codex_counter(snapshot.total, 'reasoning_output_tokens') || ':' ||
          pg_temp.codex_counter(snapshot.total, 'total_tokens')
      ORDER BY ue."occurredAt" ASC, ue."createdAt" ASC, ue."id" ASC
    ) AS "rank"
  FROM "UsageEvent" ue
  CROSS JOIN LATERAL (
    SELECT ue."rawJson" -> 'payload' -> 'info' -> 'total_token_usage' AS total
  ) AS snapshot
  WHERE ue."source" = 'codex'
    AND ue."sessionId" ~ '^[A-Za-z0-9._-]+$'
    AND jsonb_typeof(snapshot.total) = 'object'
    AND snapshot.total ? 'total_tokens'
    AND (
      pg_temp.codex_counter(snapshot.total, 'input_tokens') > 0 OR
      pg_temp.codex_counter(snapshot.total, 'cached_input_tokens') > 0 OR
      pg_temp.codex_counter(snapshot.total, 'cache_write_input_tokens') > 0 OR
      pg_temp.codex_counter(snapshot.total, 'output_tokens') > 0 OR
      pg_temp.codex_counter(snapshot.total, 'reasoning_output_tokens') > 0 OR
      pg_temp.codex_counter(snapshot.total, 'total_tokens') > 0
    )
) AS ranked;

DELETE FROM "UsageEvent" ue
USING "_CodexUsageCanonical" duplicate
WHERE ue."id" = duplicate."id"
  AND duplicate."rank" > 1;

UPDATE "UsageEvent" ue
SET "sourceEventId" = canonical."canonicalId"
FROM "_CodexUsageCanonical" canonical
WHERE ue."id" = canonical."id"
  AND canonical."rank" = 1
  AND ue."sourceEventId" <> canonical."canonicalId";
