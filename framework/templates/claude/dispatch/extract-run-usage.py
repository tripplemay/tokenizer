#!/usr/bin/env python3
"""Extract a bounded token-usage summary from a dispatched CLI run log.

BL-DISPATCH-USAGE-CAPTURE (framework side). Sandboxed local-cli dispatches
deliberately keep vendor session files out of the user's home (e.g. the codex
adapter runs with --ephemeral), so the captured run log is the only surviving
record of what the dispatched run consumed. This tool turns that log into a
machine-checkable ``usage`` block for run-meta:

    {"model": str|null, "input_tokens": int, "cached_input_tokens": int,
     "cache_write_tokens": int, "output_tokens": int, "reasoning_tokens": int,
     "turns": int, "extracted_from": "run-log"}

Per-adapter extraction rules AND the ``usage_capture`` mode
("materialize" | "attribution_only") live here as the single authority — the
mode is a property of how that CLI persists sessions, the same knowledge
domain as the extraction rule. Consumers use the mode to decide whether the
summary may become a billing event.
Extraction is a bypass, never a gate: any failure yields usage=null and the
dispatch outcome is untouched.

Usage:
  extract-run-usage.py --log <run.log> --adapter <name> [--into <run-meta.json>]
Exit 0 always (except invalid CLI arguments); prints the usage JSON (or null).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

MAX_TOKENS = 10**12
MAX_LOG_BYTES = 64 * 1024 * 1024
MAX_MODEL_LEN = 128

# usage_capture semantics an adapter may declare. "materialize": the run log is
# the sole record, the consumer may turn the summary into a usage event.
# "attribution_only": the vendor CLI writes collectable session logs to the
# real home (e.g. kimi wire files picked up by the normal collector), so the
# summary is for batch attribution only — materializing would double-count.
USAGE_CAPTURE_MODES = {"materialize", "attribution_only"}


def bounded(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if value < 0 or value > MAX_TOKENS:
        return None
    return value


def extract_codex(lines: list[dict]) -> dict | None:
    """codex exec --json: each turn ends with a ``turn.completed`` carrying a
    usage block. Observed exec runs emit exactly one turn; multi-turn logs are
    summed and flagged via ``turns`` so a reviewer can re-derive semantics
    (per-turn vs cumulative is unverified beyond one turn — 未核)."""
    totals = {
        "input_tokens": 0,
        "cached_input_tokens": 0,
        "cache_write_tokens": 0,
        "output_tokens": 0,
        "reasoning_tokens": 0,
    }
    key_map = {
        "input_tokens": "input_tokens",
        "cached_input_tokens": "cached_input_tokens",
        "cache_write_input_tokens": "cache_write_tokens",
        "output_tokens": "output_tokens",
        "reasoning_output_tokens": "reasoning_tokens",
    }
    turns = 0
    model: str | None = None
    for entry in lines:
        if entry.get("type") == "turn.completed" and isinstance(entry.get("usage"), dict):
            raw = entry["usage"]
            parsed: dict[str, int] = {}
            for source_key, target_key in key_map.items():
                if source_key in raw:
                    value = bounded(raw[source_key])
                    if value is None:
                        return None  # corrupt usage payload: refuse to guess
                    parsed[target_key] = value
            if "input_tokens" not in parsed or "output_tokens" not in parsed:
                continue
            turns += 1
            for target_key, value in parsed.items():
                totals[target_key] += value
        if model is None:
            candidate = entry.get("model")
            if isinstance(candidate, str) and 0 < len(candidate) <= MAX_MODEL_LEN:
                model = candidate
    if turns == 0:
        return None
    if any(value > MAX_TOKENS for value in totals.values()):
        return None
    return {"model": model, **totals, "turns": turns, "extracted_from": "run-log"}


def extract_kimi(lines: list[dict]) -> dict | None:
    """kimi local-cli run logs carry no usage records (verified on real runs:
    usage lives only in the wire files the normal collector already reads).
    Declared for completeness; always yields null."""
    return None


# adapter name -> (usage_capture mode, extractor). The mode is a property of
# how that CLI persists sessions, i.e. the same knowledge domain as the
# extraction rule — single authority here, adapters do not re-declare it.
EXTRACTORS = {
    "codex": ("materialize", extract_codex),
    "kimi": ("attribution_only", extract_kimi),
}


def parse_log(path: Path) -> list[dict]:
    if path.stat().st_size > MAX_LOG_BYTES:
        return []
    entries: list[dict] = []
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if isinstance(value, dict):
                entries.append(value)
    return entries


def merge_into(meta_path: Path, usage: dict | None, capture_mode: str | None) -> None:
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if not isinstance(meta, dict):
        raise SystemExit("[extract-usage] run-meta must be a JSON object")
    meta["usage"] = usage
    if capture_mode is not None:
        meta["usage_capture"] = capture_mode
    fd, temp = tempfile.mkstemp(dir=str(meta_path.parent), prefix=".usage-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(meta, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temp, meta_path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--log", required=True)
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--into", default=None)
    parser.add_argument("--capture-mode", default=None, choices=sorted(USAGE_CAPTURE_MODES))
    args = parser.parse_args()

    usage: dict | None = None
    rule = EXTRACTORS.get(args.adapter)
    capture_mode = args.capture_mode or (rule[0] if rule is not None else None)
    log_path = Path(args.log)
    if rule is not None and log_path.is_file():
        try:
            usage = rule[1](parse_log(log_path))
        except Exception as exc:  # bypass, never a gate
            print(f"[extract-usage] extraction failed, usage=null: {exc}", file=sys.stderr)
            usage = None

    if args.into is not None:
        merge_into(Path(args.into), usage, capture_mode)
    print(json.dumps({"usage": usage, "usage_capture": capture_mode}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
