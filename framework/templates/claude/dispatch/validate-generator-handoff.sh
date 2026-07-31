#!/usr/bin/env bash
# Mechanical validator for an external Generator handoff. It validates the
# artifact against the exact Generator envelope that commissioned it; this is
# deliberately separate from receipt inference, which only knows transport
# outcomes and waiting states.
#
# Usage:
#   validate-generator-handoff.sh <artifact> --envelope <generator-envelope>

set -euo pipefail

ARTIFACT="${1:-}"
[ -n "$ARTIFACT" ] || {
  echo "usage: validate-generator-handoff.sh <artifact> --envelope <generator-envelope>" >&2
  exit 2
}
shift
ENVELOPE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --envelope)
      [ "$#" -ge 2 ] || {
        echo "[generator-handoff] missing --envelope value" >&2
        exit 2
      }
      ENVELOPE="$2"
      shift 2
      ;;
    -h|--help)
      echo "usage: validate-generator-handoff.sh <artifact> --envelope <generator-envelope>" >&2
      exit 0
      ;;
    *)
      echo "[generator-handoff] unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

[ -f "$ARTIFACT" ] || {
  echo "[generator-handoff] artifact does not exist: $ARTIFACT" >&2
  exit 2
}
[ -n "$ENVELOPE" ] && [ -f "$ENVELOPE" ] || {
  echo "[generator-handoff] generator envelope does not exist: $ENVELOPE" >&2
  exit 2
}

python3 - "$ARTIFACT" "$ENVELOPE" <<'PY'
import datetime
import json
import os
import re
import sys

artifact_path, envelope_path = sys.argv[1:3]

try:
    artifact = json.load(open(artifact_path, encoding="utf-8"))
except Exception as exc:
    print(f"[generator-handoff] invalid artifact JSON: {exc}", file=sys.stderr)
    raise SystemExit(2)

try:
    envelope = json.load(open(envelope_path, encoding="utf-8"))
except Exception as exc:
    print(f"[generator-handoff] invalid envelope JSON: {exc}", file=sys.stderr)
    raise SystemExit(2)

errors = []

def exact_keys(value, required, optional=(), label="object"):
    if not isinstance(value, dict):
        errors.append(f"{label} must be an object")
        return False
    required, optional = set(required), set(optional)
    missing = sorted(required - set(value))
    extra = sorted(set(value) - required - optional)
    if missing:
        errors.append(f"{label} is missing fields {missing}")
    if extra:
        errors.append(f"{label} contains non-contract fields {extra}")
    return not missing and not extra

def nonempty(value, label):
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{label} must be a non-empty string")
        return False
    return True

def repo_relative_path(value, label):
    if not nonempty(value, label):
        return False
    if "\x00" in value or "\\" in value or value.startswith("/"):
        errors.append(f"{label} must be a safe repository-relative path")
        return False
    components = value.split("/")
    if any(component in ("", ".", "..") for component in components):
        errors.append(f"{label} must not contain empty, '.' or '..' components")
        return False
    return True

def utc_timestamp(value, label):
    if not nonempty(value, label):
        return
    if not isinstance(value, str):
        return
    if not value.endswith("Z"):
        errors.append(f"{label} must be an ISO8601 UTC timestamp ending in Z")
        return
    try:
        parsed = datetime.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        errors.append(f"{label} must be an ISO8601 UTC timestamp")
        return
    if parsed.tzinfo is None:
        errors.append(f"{label} must include a UTC offset")

def string_list(value, label, minimum=0):
    if not isinstance(value, list) or len(value) < minimum:
        errors.append(f"{label} must be an array with at least {minimum} items")
        return []
    seen = set()
    out = []
    for index, item in enumerate(value):
        if nonempty(item, f"{label}[{index}]"):
            if item in seen:
                errors.append(f"{label} contains a duplicate value {item!r}")
            seen.add(item)
            out.append(item)
    return out

if not isinstance(envelope, dict):
    errors.append("envelope must be an object")
    envelope = {}

deliverable = envelope.get("deliverable")
if envelope.get("role") != "generator":
    errors.append("envelope role must be generator")
if not isinstance(deliverable, dict):
    errors.append("envelope deliverable must be an object")
    deliverable = {}
if deliverable.get("schema") != ".claude/dispatch/generator-handoff.schema.json":
    errors.append("envelope deliverable.schema is not the Generator handoff schema")
if deliverable.get("commit_to", object()) is not None:
    errors.append("envelope deliverable.commit_to must be explicitly null")

expected_batch = envelope.get("batch")
if not nonempty(expected_batch, "envelope.batch"):
    expected_batch = None
repo = envelope.get("repo")
if (
    not isinstance(repo, dict)
    or not isinstance(repo.get("ref"), str)
    or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", repo["ref"])
):
    errors.append("envelope.repo.ref must be a canonical immutable commit SHA")
expected_features = envelope.get("features")
if not isinstance(expected_features, list) or not expected_features:
    errors.append("envelope.features must be a non-empty array for a Generator handoff")
    expected_features = []
else:
    expected_features = string_list(expected_features, "envelope.features", 1)

exact_keys(
    artifact,
    ("batch_id", "created_at"),
    ("features", "l1_ran", "waiting", "waiting_detail"),
    "generator handoff",
)
if artifact.get("batch_id") != expected_batch:
    errors.append(
        f"batch_id does not match the dispatch envelope: {artifact.get('batch_id')!r}"
    )
utc_timestamp(artifact.get("created_at"), "created_at")

waiting = artifact.get("waiting", None)
if waiting not in (None, "auth", "adjudication"):
    errors.append("waiting must be null, auth, or adjudication")
if waiting in ("auth", "adjudication"):
    nonempty(artifact.get("waiting_detail"), "waiting_detail")
elif "waiting_detail" in artifact:
    errors.append("waiting_detail is only allowed when waiting is auth or adjudication")

handoff_features = artifact.get("features")
if waiting is None and "features" not in artifact:
    errors.append("completed Generator handoff must include features")
if handoff_features is not None and not isinstance(handoff_features, list):
    errors.append("features must be an array")
    handoff_features = []
if handoff_features is None:
    handoff_features = []

seen_features = set()
returned_features = []
for index, feature in enumerate(handoff_features):
    exact_keys(
        feature,
        ("feature_id", "files_touched"),
        ("commits", "notes"),
        f"features[{index}]",
    )
    if not isinstance(feature, dict):
        continue
    feature_id = feature.get("feature_id")
    if nonempty(feature_id, f"features[{index}].feature_id"):
        if feature_id in seen_features:
            errors.append(f"features[{index}].feature_id is duplicated: {feature_id!r}")
        seen_features.add(feature_id)
        returned_features.append(feature_id)
        if feature_id not in expected_features:
            errors.append(
                f"features[{index}].feature_id={feature_id!r} was not commissioned by the envelope"
            )

    files = feature.get("files_touched")
    if not isinstance(files, list) or not files:
        errors.append(f"features[{index}].files_touched must be a non-empty array")
    else:
        seen_files = set()
        for file_index, path in enumerate(files):
            if repo_relative_path(path, f"features[{index}].files_touched[{file_index}]"):
                if path in seen_files:
                    errors.append(
                        f"features[{index}].files_touched contains duplicate path {path!r}"
                    )
                seen_files.add(path)

    if "commits" in feature:
        string_list(feature["commits"], f"features[{index}].commits", 0)
    if "notes" in feature and not isinstance(feature["notes"], str):
        errors.append(f"features[{index}].notes must be a string")

if waiting is None:
    missing_features = sorted(set(expected_features) - set(returned_features))
    if missing_features:
        errors.append(
            "completed handoff is missing commissioned features " + repr(missing_features)
        )

if "l1_ran" in artifact:
    l1 = artifact["l1_ran"]
    exact_keys(l1, (), ("lint", "typecheck", "test"), "l1_ran")
    if isinstance(l1, dict):
        for key, value in l1.items():
            if not isinstance(value, str):
                errors.append(f"l1_ran.{key} must be a string")

if errors:
    print("[generator-handoff] handoff validation failed:", file=sys.stderr)
    for error in errors:
        print("  - " + error, file=sys.stderr)
    raise SystemExit(2)

print("[generator-handoff] handoff is valid", file=sys.stderr)
PY
