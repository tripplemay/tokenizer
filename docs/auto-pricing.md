# Auto-pricing for unpriced models

Vendors ship new models constantly, and each new model shows up **unpriced** in
the dashboard (cost renders as `—`, its tokens land in the "Unpriced" tile).
Before this feature, fixing that meant SSHing to the VPS, running `psql` to find
the model, editing `MODEL_PRICES` in code, and redeploying.

Now the system **detects** new models automatically and lets you price them
without a redeploy — with an optional automatic price **lookup** on top.

## How it works

### 1. Prices are a seed + a DB overlay
- `src/shared/model-pricing.ts` `MODEL_PRICES` is still the hand-curated **seed**
  (and the source of truth for the models it lists).
- A new global `ModelPrice` table **overlays** the seed for keys it doesn't
  cover. `src/server/model-prices.ts` `getEffectivePrices()` returns
  `{ ...seed, ...billableOverlay }`, keyed by `normalizeModelKey`.
- **Only** rows with status `auto_applied` or `approved` are billable. Every
  other status is tracked but changes no reported cost — so "unpriced beats a
  guessed price" holds until a trusted source or a human signs off.
- Cost is computed at render time, so an approved price **reprices all history
  automatically** — no backfill. Dashboards refresh within the 30s cache TTL (or
  instantly: an approval calls `revalidateTag`).

### 2. Detection (always on, event-driven)
On ingest (`src/server/ingest.ts` → `src/server/pricing/detect.ts`), any model
that the seed doesn't price and that isn't already tracked gets a `ModelPrice`
row:
- `-free` suffix → auto-applied `$0` by convention.
- everything else → `detected`, awaiting a lookup.

Detection is best-effort and fully isolated — it can never fail a client upload.
The manual net is **Scan now** on `/admin/pricing` (or
`POST /api/admin/pricing/scan`), which discovers every unpriced model across all
historical usage.

### 3. Lookup (gated by `PRICING_AUTO_ENABLED`, runs out-of-band)
When enabled, a lookup is triggered via Next's `after()` (post-response, so
external HTTP never blocks an upload) for newly-detected keys. For each key
(`src/server/pricing/lookup.ts`):
1. **LiteLLM** (`model_prices_and_context_window.json`) — authoritative list
   price, four tiers, bare-key match for US first-party models.
2. **OpenRouter** (`/api/v1/models`) — the long tail (GLM, DeepSeek-v4, MiniMax,
   Gemini previews, newest GPT). Ids are mapped in `src/server/pricing/mapping.ts`
   (provider slug + `dash→dot` + `-free→:free` + an explicit alias table).
3. **LLM fallback** (optional) — a candidate price **with a source URL**, always
   `pending_review`.

**Tiering** (`classifyStructuredCandidates`): auto-apply **only** on an exact
structured match with all four tiers present and (if both sources hit) agreement
within 1%. Anything with derived cache tiers, a source conflict, or from the LLM
becomes `pending_review` — pre-filled but not billable until approved.

### 4. Review (`/admin/pricing`)
Admin-only queue (action-needed rows first) with global token volume per model.
Per row: **Approve / Edit → Save / Reject / Re-lookup**. Approving or editing
makes the price live immediately.

## Operating it

### Grant admin
`role` gates the queue (`requireAdmin`, session `user.role === "admin"`). Set it
once per operator:
```sql
UPDATE "User" SET role = 'admin' WHERE email = 'you@example.com';
```
The legacy `ADMIN_TOKEN` also authorizes the API routes (for scripts).

### Enable auto-lookup
Set `PRICING_AUTO_ENABLED=1` (repo Variable → deploy `.env`). Optional:
- `LITELLM_PRICES_URL` — pin to a commit-SHA raw URL for reproducibility.
- `OPENROUTER_MODELS_URL` — override.
- `PRICING_LLM_BASE_URL` / `PRICING_LLM_KEY` / `PRICING_LLM_MODEL` — OpenAI-
  compatible endpoint for the fallback (e.g. the AIGC gateway). Omit to skip it.

### Rollout order
1. Deploy (migration adds `ModelPrice`; feature ships **off**).
2. `Scan now` to seed the queue from existing usage; price the high-volume
   models by hand (`Edit → Save`) — this alone replaces the psql+redeploy chore.
3. Flip `PRICING_AUTO_ENABLED=1` once you've spot-checked LiteLLM/OpenRouter
   coverage against your production `distinct(model)`; the auto tier fills the
   easy models, the rest queue as pre-filled `pending_review`.

Success metric: the home **Unpriced tokens** tile trending toward zero.

## Notes / limits
- The `observedModels` guard in `tests/shared/model-pricing.test.ts` still checks
  the **static seed** only. Auto-priced-but-unpromoted models are intentionally
  not in it; promote a well-established price into the seed if you want the
  tripwire to cover it.
- The overlay never *auto*-overrides a seed key (detection/scan skip seeded
  keys); an admin can still deliberately override one via Edit.
- `-free` → `$0` is a convention, not a guarantee — re-classify if a paid model
  ever ends in `-free`.
