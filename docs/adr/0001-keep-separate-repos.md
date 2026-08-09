# ADR 0001: Keep the Framework and Product in Separate Repositories

## Status

Accepted

## Date

2026-08-09

## Context

`harness-template` and `tokenizer` have different ownership and release semantics. The former is the versioned, tool-neutral Triad Workflow framework distributed to multiple consumer repositories. The latter is the tokenizer product: its Next.js service and local device agent jointly provide usage accounting and the harness control plane. `tokenizer/framework/` is an installed, pinned mirror of the framework, not its source tree.

The only material benefit unique to a merge is that the console contract producer and consumer could evolve in one commit. Today those sides are the tokenizer server under `app/api/harness/` and `src/server/`, and the framework validators and schemas under `templates/claude/console/`. That coupling is real, but it can be guarded mechanically without changing repository ownership.

The [full repository strategy analysis](../analysis/2026-08-08-repo-strategy/README.md) reached the same recommendation through three independent review lenses:

| Review lens | Recommendation | Confidence |
|---|---|---:|
| Release engineering | keep-separate | 0.85 |
| Consumer operations | keep-separate | 0.80 |
| Product positioning | keep-separate | 0.72 |

The scores and complete rationales are retained in [`appendix/judges.json`](../analysis/2026-08-08-repo-strategy/appendix/judges.json).

### Decision drivers

1. **A merge breaks the current distribution contract.** Remote sync clones the URL pinned in `harness.json`, then requires `harness/` and `templates/` at the source root; a product repository with the framework below a subdirectory fails that check ([`.claude/harness.sh:82-93`](../../.claude/harness.sh#L82-L93)). Initialization and adoption also persist the dedicated template repository URL ([`.claude/harness.sh:267-271`](../../.claude/harness.sh#L267-L271), [`.claude/harness.sh:482-487`](../../.claude/harness.sh#L482-L487)). Existing consumers would therefore need a coordinated bootstrap, source URL, and local harness replacement rather than an ordinary sync; the consumer inventory and migration path are documented in [`reader-ecosystem.md` section 4](../analysis/2026-08-08-repo-strategy/appendix/reader-ecosystem.md).

2. **The repositories have independent version streams.** The product pins a framework version and commit instead of sharing its history ([`harness.json`](../../harness.json)); the framework mirror carries its own `VERSION`, `CHANGELOG.md`, and release manifest ([`framework/VERSION`](../../framework/VERSION), [`framework/CHANGELOG.md`](../../framework/CHANGELOG.md), [`framework-releases.json`](../../framework/harness/framework-releases.json)). Moving framework tags onto product commits would reverse the dependency direction and mix framework releases with product deployment history. The measured tag and history evidence is recorded in [`reader-ecosystem.md` section 4d](../analysis/2026-08-08-repo-strategy/appendix/reader-ecosystem.md).

3. **A merge couples framework CI to production deployment in both directions.** Product pushes are governed by a deploy workflow whose verification and deployment jobs share one trigger, with framework-owned paths explicitly excluded ([`deploy-vps.yml:3-32`](../../.github/workflows/deploy-vps.yml#L3-L32)). Framework files outside that exclusion would deploy the product; putting all framework files under excluded paths would skip its release checks. The repository boundary currently supplies that isolation. Cross-repository checks belong in a separate, path-scoped workflow, as implemented by [`contract-conformance.yml`](../../.github/workflows/contract-conformance.yml).

4. **A merge reverses the managed-mirror ledger.** The harness distinguishes framework-owned `managed` files from project-owned `seeded` files ([`.claude/harness.sh:96-114`](../../.claude/harness.sh#L96-L114)) and records current and upstream hashes in [`harness.lock`](../../harness.lock). Making `tokenizer/framework/` both the upstream source and the downstream mirror would invalidate drift detection, `FRAMEWORK_MIRROR`, and the paired `framework/templates/claude/**` to `.claude/**` installation model. The baseline measurements and paired-mirror evidence are in [`reader-evolution.md` sections 2 and 5](../analysis/2026-08-08-repo-strategy/appendix/reader-evolution.md).

5. **A merge removes the framework's product neutrality.** The framework contract explicitly places the channel B relay in another project and states that any outbound-agent system may implement it; tokenizer is an implementation, not part of the framework ([`console-mode.md:291-296`](../../framework/harness/console-mode.md#L291-L296)). Housing the framework source and tags inside that one implementation would turn a neutral contract into product internals and constrain separate licensing, adoption, and replacement implementations.

6. **A merge does not remove the dominant maintenance costs.** Repeated consumer sync, local conflict resolution, rollout, and testing arise because each consumer has a materialized copy, not because the source and tokenizer are in separate repositories. The observed duplicate-patch, upgrade-test, fan-out, and paired-mirror costs are catalogued in [`reader-evolution.md` section 5](../analysis/2026-08-08-repo-strategy/appendix/reader-evolution.md). The one merge-only benefit, same-commit evolution of the gate and mode-intent contract, is identified in [`reader-ecosystem.md` section 4f](../analysis/2026-08-08-repo-strategy/appendix/reader-ecosystem.md) and is cheaper to cover with pinned contract tests.

## Decision

Keep `harness-template` and `tokenizer` as separate repositories.

- `harness-template` remains the sole framework source and owner of the framework release/tag sequence, schemas, validators, bootstrap machinery, and reusable contract fixtures.
- `tokenizer` continues to own the hosted product and local device agent. Its `framework/` directory remains a version-pinned, `harness.lock`-managed mirror.
- Contract changes follow an upstream-first sequence: define and release the framework contract, update tokenizer's pinned mirror, then implement or adjust the product-side relay.
- Repository coordination is replaced by three mechanical controls:
  1. **Versioned contract fixtures in the framework repository:** schema snapshots, canonical JSON vectors, and valid/invalid signed pending-gate and mode-intent payloads are released with the framework manifest.
  2. **Pinned cross-repository contract CI in tokenizer:** the contract workflow checks out the exact framework commit from `harness.json` and runs both directions, product signatures through framework validators and framework fixtures through product parsers ([`contract-conformance.yml:32-47`](../../.github/workflows/contract-conformance.yml#L32-L47)).
  3. **Manifest-derived version tests in tokenizer:** current and prior framework expectations come from the mirrored release manifest rather than duplicated current-version literals ([`framework-version.test.ts`](../../tests/shared/framework-version.test.ts), [`mode-badges.test.ts`](../../tests/shared/mode-badges.test.ts)).

This ADR is implemented by [BL-REPO-MECH](../specs/BL-REPO-MECH-spec.md), which ties the three controls to the repository and deployment changes in the same batch.

### Hybrid exit clause

If tokenizer later needs to import framework contract primitives at runtime, extract only a small, independently versioned **contract artifact** containing schemas, canonical JSON behavior, shared types, and conformance vectors. Publish it as a third package/repository, or as an equivalently versioned vendored artifact, and require both repositories to pin it.

This exit does not authorize moving the full framework into tokenizer or splitting bootstrap-required machinery out of the framework. A full repository merge would require a new ADR with evidence that the contract artifact and pinned conformance CI are insufficient, plus an explicit migration plan for consumers, tags, bootstrap, the lock ledger, and deployment triggers.

## Consequences

Positive consequences:

- Framework releases, product deployments, histories, and rollback scopes stay independent.
- Existing `sync --from` and `sync --ref` layouts remain valid for all consumers.
- The framework retains its tool- and relay-neutral contract boundary.
- Cross-repository drift moves from manual production rehearsal to reproducible, version-pinned CI.
- Product version tests change only when comparison semantics change, not on every framework release.

Costs and obligations:

- Contract work remains a two-repository, upstream-first release sequence; both the fixture release and tokenizer pin update must be reviewed.
- Consumer rollout, local customization conflicts, and materialized mirror duplication remain and should be reduced by tooling rather than attributed to repository layout.
- Tokenizer contract CI depends on availability of the pinned framework commit and must fail visibly when fixtures or schemas drift.
- The deploy workflow may ignore `docs/**` only while runtime code does not read files from that directory. If documentation becomes a runtime asset, the path exclusion must be narrowed before that dependency is introduced ([`deploy-vps.yml:13-15`](../../.github/workflows/deploy-vps.yml#L13-L15)).
