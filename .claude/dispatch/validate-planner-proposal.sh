#!/usr/bin/env bash
# Mechanical validator for the Planner's proposal artifact. The Planner only
# proposes; the Coordinator validates, asks the human, and materializes any
# accepted proposal. This script intentionally has no writeback behavior.
#
# Usage:
#   validate-planner-proposal.sh <artifact> [expected-task-id expected-batch expected-ref]

set -euo pipefail

ARTIFACT="${1:?用法: validate-planner-proposal.sh <artifact> [expected-task-id expected-batch expected-ref]}"
EXPECTED_TASK_ID="${2:-}"
EXPECTED_BATCH="${3:-}"
EXPECTED_REF="${4:-}"

[ -f "$ARTIFACT" ] || { echo "[planner-proposal] ⛔ 产物不存在：$ARTIFACT" >&2; exit 2; }

python3 - "$ARTIFACT" "$EXPECTED_TASK_ID" "$EXPECTED_BATCH" "$EXPECTED_REF" <<'PY'
import datetime
import json
import re
import sys

path, expected_task, expected_batch, expected_ref = sys.argv[1:5]

try:
    proposal = json.load(open(path, encoding="utf-8"))
except Exception as exc:
    print(f"[planner-proposal] ⛔ 产物 JSON 非法：{exc}", file=sys.stderr)
    raise SystemExit(2)

errors = []

def exact_keys(value, required, optional=(), label="object"):
    if not isinstance(value, dict):
        errors.append(f"{label} 必须是 object")
        return
    required, optional = set(required), set(optional)
    missing = sorted(required - set(value))
    extra = sorted(set(value) - required - optional)
    if missing:
        errors.append(f"{label} 缺字段 {missing}")
    if extra:
        errors.append(f"{label} 含白名单外字段 {extra}")

def nonempty(value, label):
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{label} 必须是非空 string")

def timestamp(value, label):
    nonempty(value, label)
    if not isinstance(value, str):
        return
    try:
        datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        errors.append(f"{label} 必须是 ISO8601 timestamp")

def string_list(value, label, minimum=0):
    if not isinstance(value, list) or len(value) < minimum:
        errors.append(f"{label} 必须是至少 {minimum} 项的 array")
        return
    for index, item in enumerate(value):
        nonempty(item, f"{label}[{index}]")

exact_keys(
    proposal,
    (
        "proposal_version", "task_id", "batch_id", "source_ref", "kind", "created_at",
        "summary", "questions", "spec", "features", "decisions", "waiting",
    ),
    ("waiting_detail",),
    "planner proposal",
)

if proposal.get("proposal_version") != "planner-proposal/1":
    errors.append("proposal_version 必须为 'planner-proposal/1'")
for field in ("task_id", "batch_id", "summary"):
    nonempty(proposal.get(field), field)
if not isinstance(proposal.get("task_id"), str) or len(proposal.get("task_id", "")) < 8:
    errors.append("task_id 至少 8 个字符")
source_ref = proposal.get("source_ref")
if not isinstance(source_ref, str) or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", source_ref):
    errors.append("source_ref 必须是 40 或 64 位小写十六进制 immutable commit SHA")
if proposal.get("kind") not in ("batch_plan", "adjudication"):
    errors.append("kind 必须为 batch_plan 或 adjudication")
timestamp(proposal.get("created_at"), "created_at")

questions = proposal.get("questions")
if not isinstance(questions, list):
    errors.append("questions 必须是 array")
else:
    seen_questions = set()
    for index, question in enumerate(questions):
        exact_keys(question, ("id", "question", "blocking"), ("options",), f"questions[{index}]")
        nonempty(question.get("id") if isinstance(question, dict) else None, f"questions[{index}].id")
        nonempty(question.get("question") if isinstance(question, dict) else None, f"questions[{index}].question")
        if isinstance(question, dict):
            qid = question.get("id")
            if isinstance(qid, str):
                if qid in seen_questions:
                    errors.append(f"questions[{index}].id 重复：{qid}")
                seen_questions.add(qid)
            if type(question.get("blocking")) is not bool:
                errors.append(f"questions[{index}].blocking 必须是 boolean")
            if "options" in question:
                string_list(question["options"], f"questions[{index}].options", 1)

spec = proposal.get("spec")
if spec is not None:
    exact_keys(spec, ("title", "markdown"), label="spec")
    if isinstance(spec, dict):
        nonempty(spec.get("title"), "spec.title")
        nonempty(spec.get("markdown"), "spec.markdown")
    else:
        errors.append("spec 必须为 object 或 null")

features = proposal.get("features")
if not isinstance(features, list):
    errors.append("features 必须是 array")
else:
    seen_features = set()
    for index, feature in enumerate(features):
        exact_keys(feature, ("id", "title", "priority", "executor", "acceptance"), label=f"features[{index}]")
        if not isinstance(feature, dict):
            continue
        for field in ("id", "title", "acceptance"):
            nonempty(feature.get(field), f"features[{index}].{field}")
        fid = feature.get("id")
        if isinstance(fid, str):
            if fid in seen_features:
                errors.append(f"features[{index}].id 重复：{fid}")
            seen_features.add(fid)
        if feature.get("priority") not in ("high", "medium", "low"):
            errors.append(f"features[{index}].priority 非法")
        if feature.get("executor") not in ("generator", "evaluator"):
            errors.append(f"features[{index}].executor 非法")

decisions = proposal.get("decisions")
if not isinstance(decisions, list):
    errors.append("decisions 必须是 array")
else:
    seen_decisions = set()
    for index, decision in enumerate(decisions):
        exact_keys(decision, ("id", "resolution", "rationale", "affected_paths"), label=f"decisions[{index}]")
        if not isinstance(decision, dict):
            continue
        for field in ("id", "resolution", "rationale"):
            nonempty(decision.get(field), f"decisions[{index}].{field}")
        did = decision.get("id")
        if isinstance(did, str):
            if did in seen_decisions:
                errors.append(f"decisions[{index}].id 重复：{did}")
            seen_decisions.add(did)
        string_list(decision.get("affected_paths"), f"decisions[{index}].affected_paths")

waiting = proposal.get("waiting")
if waiting not in (None, "input"):
    errors.append("waiting 必须为 null 或 input")
if waiting == "input":
    nonempty(proposal.get("waiting_detail"), "waiting_detail")
elif "waiting_detail" in proposal:
    errors.append("waiting=null 时不得携带 waiting_detail")

if waiting is None and proposal.get("kind") == "batch_plan":
    if not isinstance(spec, dict):
        errors.append("完整 batch_plan 必须含 spec object")
    if not isinstance(features, list) or not features:
        errors.append("完整 batch_plan 至少需要一条 feature")
if waiting is None and proposal.get("kind") == "adjudication":
    if not isinstance(decisions, list) or not decisions:
        errors.append("完整 adjudication 至少需要一条 decision")

if expected_task and proposal.get("task_id") != expected_task:
    errors.append(f"task_id 与 dispatch envelope 不匹配：{proposal.get('task_id')!r}")
if expected_batch and proposal.get("batch_id") != expected_batch:
    errors.append(f"batch_id 与 dispatch envelope 不匹配：{proposal.get('batch_id')!r}")
if expected_ref and isinstance(source_ref, str) and source_ref != expected_ref:
    errors.append(f"source_ref 与 dispatch envelope 不匹配：{source_ref!r}")

if errors:
    print("[planner-proposal] ⛔ Planner proposal 校验失败：", file=sys.stderr)
    for error in errors:
        print("   - " + error, file=sys.stderr)
    raise SystemExit(2)

print("[planner-proposal] ✓ Planner proposal 合法", file=sys.stderr)
PY
