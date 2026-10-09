# BL-COMPOSE-VERSION-SHAPE: supporting diagnosis only

## Authority and decisive evidence

The Coordinator uses null-binding Planner compatibility. This is a section 1.5
supporting diagnosis, not a canonical feature or release signoff. Base is
917b60c (the retained actual result of protected run 37844242857). That run was
human-approved and refused at compose_unavailable with invalid_version,
pipeline_exit_status=0, captured_bytes=27 and home_present=false. The retained
string's syntax is unknown. Do not guess a vendor prefix, distro suffix, HOME
cause, missing plugin or timeout. release_ready remains false.

## Narrow new scope

An isolated Generator may edit only:

1. scripts/ci/vps-host-preflight.sh: pure bounded classification of the existing
   retained Compose string, its initialization and report serialization.
2. .github/workflows/deploy-vps.yml: only the existing host-preflight jq validator
   to accept and strictly validate one required compose_version_shape field.
3. tests/ci/vps-host-preflight-observability.test.ts: only its scope-normalization
   pins, old-report comparison stripping, and the five synthetic acceptance
   fixtures in `validates each fixed classification` for the newly allowed field.
   The previous diagnostic test's exact serialization/source pins must explicitly
   account for this added scope. Add consistent shape objects/nulls to those
   five fixtures. The old ok/captured_bytes=0 fixture is impossible for its
   nonempty accepted version; replace only that count with the byte length of
   body.versions.compose, and add a new explicit rejection control for the
   former impossible combination. Preserve all other compose_probe values,
   functional expectations, test count, caps, timeouts and rejection cases. This is an explicit
   scope extension; never claim that no existing diagnostic test changed.
4. New tests/ci/vps-compose-version-shape.test.ts, this spec and artifacts under
   docs/test-reports/BL-COMPOSE-VERSION-SHAPE-20261009/.

All 43 original host-preflight tests, all other old tests/fixtures/assertions,
product code, dependencies, state machines, rules, credentials and prior evidence
are frozen. Every workflow byte outside the existing validator is frozen.
Existing compose_probe (its exact four keys), shared query(), capture argv,
capture order, version acceptance regex, failure reason/outcome, versions fields,
5s/16384-byte query bound, 16385-byte detector and 150s/65536-byte SSH/report
bounds are frozen. No fallback, plugin search/install, HOME/environment restoration,
config read/write, additional host queries, Docker operation, DB operation or
runtime mutation. No worker push, GH production API, SSH or credential access.

## Fixed shape contract

Add required compose_version_shape to full reports; minimal missing-jq report is
unchanged. It is null before successful bounded capture, on nonzero pipeline or
output overflow. Otherwise it is an exact object, computed from that same retained
string (never total emitted stdout/stderr):

- prefix: empty, numeric, v_numeric, docker_compose_version, other. numeric means
  a decimal digit at byte zero; v_numeric means literal v followed by a digit;
  docker_compose_version means exact literal `Docker Compose version ` at zero.
- core_present: Boolean. For numeric/v_numeric or the exact fixed vendor prefix,
  recognize only a leading optional-v decimal major.minor.patch. Do not serialize
  any matched component. Remove only the exact fixed vendor prefix from a local
  classification candidate before core parsing, without modifying the captured
  value. No core parsing for other/empty prefix.
- tail_bytes: null without a parsed core; otherwise retained bytes following the
  core, integer 0..16384. Preserve bytes; do not trim or normalize.
- tail_charset: not_parsed without a core; empty for zero tail; legacy for nonempty
  [a-zA-Z0-9.+-]+; legacy_plus_tilde for the same alphabet plus ~ and at least one
  ~; legacy_plus_underscore similarly plus _; legacy_plus_tilde_underscore for both;
  other otherwise. This classifies, not accepts, a version or distro suffix.
- has_cr, has_lf, has_horizontal_space, has_escape, has_non_ascii: Booleans over
  the complete retained string. Horizontal space means literal ASCII space or tab;
  escape means byte 0x1b; non-ASCII means any retained byte outside 0x00..0x7f.

Classification must be byte-based and locale-independent without changing the
ambient locale of any existing query. Only pure bounded shell operations may
inspect the retained string; no new external query. Report only these fixed labels,
counts and flags, never the raw string, regex captures, arbitrary prefix/tail,
individual byte codes, stderr, environment values, HOME/path/config contents,
hashes or secrets. Never use shape metadata to allow an otherwise refused version.

The validator must enforce exact keys/types/enums/counts: no core for other/empty
prefix; absent core means null tail_bytes/not_parsed; present core means a
numeric/v_numeric/vendor prefix and integer tail_bytes <= captured_bytes and
no not_parsed class; zero tail means empty and vice versa. An empty prefix means
captured_bytes=0 and all flags false; a nonempty prefix means captured_bytes>0.
The shape is null exactly for not_run/command_failed/output_bound_exceeded, and
an object exactly for ok/invalid_version. For ok require numeric/v_numeric,
core_present=true, tail_bytes<=32, empty/legacy tail class, all flags false, and
captured_bytes equal to the ASCII byte length of versions.compose. These are
additional consistency guards, never a relaxed version acceptance rule.
Reject extra fields and inconsistent shape vs compose_probe, preserve
every existing report allowlist and never treat diagnostic execution as release.

## Independent controls and publication boundary

Retain every initial failed command/log. Preserve and run the existing 43 host
and 32 observability controls. New controls must cover every prefix/tail class,
CR/LF/space/tab/escape/non-ASCII, multibyte locale byte counts, valid and invalid
versions, command failure, oversized output, hung bounded capture, secret canaries,
unchanged argv/queries/refusal point and exact workflow validator negative cases.
Pin all frozen script/workflow bytes and old-test blobs mechanically. Scope critic
reviews before and after; fresh registered Kimi-family Evaluator independently
tests the exact source commit locally. Same-family scope review is not functional
acceptance. Evaluator originals are transported without rewriting.

Only after those supporting checks may the Coordinator publish an exact reviewed
commit to a non-main CI ref and dispatch operation=host-preflight. Every new run
requires actual human production-environment approval. All normal verification,
OCI/recovery and Deploy jobs must remain skipped. Prior approvals do not approve
new exact-source protected runs. No main push/deployment/bootstrap is enabled.
