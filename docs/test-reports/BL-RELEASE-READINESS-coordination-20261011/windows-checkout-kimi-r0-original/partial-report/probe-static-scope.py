#!/usr/bin/env python3
"""Independent static scope probe: evaluator-owned (kimi r0).

Re-renders the exact C001 projection from source888 bytes in memory and
compares it byte-for-byte with the candidate at HEAD, verifies the projected
SHA-256 identities, the unchanged tree records, frozen hashes and archive
inventories. Read-only: writes nothing outside stdout.
"""
import difflib
import hashlib
import json
import subprocess
import sys

SRC = "888a5acd7a8a441c9ec4ad898453f149cf8d6b7c"
HEAD = "221f2f87d94db1656e3000662796d79621b696f5"
PARENT = "54af183617ed06c18edd42632326dbfd09451456"

WF = ".github/workflows/windows-p1-stages-diagnostic.yml"
BJ = "docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.json"
BM = "docs/specs/BL-WINDOWS-P1-INITIAL-BINDINGS-20261010.md"
CLI = "docs/test-reports/windows-p1-stages-20261010/p1-stages.mjs"
TESTS = "tests/diagnostics/windows-p1-stages.test.ts"

REPORT_ONLY = [
    "docs/test-reports/BL-WINDOWS-P1-CHECKOUT-plan-20261011/README.md",
    "docs/test-reports/BL-WINDOWS-P1-CHECKOUT-plan-20261011/proposal.json",
    "docs/test-reports/BL-WINDOWS-P1-CHECKOUT-pre-scope-20261011/README.md",
    "docs/test-reports/BL-WINDOWS-P1-CHECKOUT-pre-scope-20261011/verdict.json",
]

FROZEN = {
    "docs/specs/BL-WINDOWS-P1-STAGES-20261009.md": "6df7819977e950fe2fa8f682110defc6ced7767651c8887f11e326c26bb35790",
    "docs/test-reports/BL-WINDOWS-P1-STAGES-plan-20261009/plan.json": "c9ae43fba212226518719dfde14336f4ebdc85fb7f072b88a686c2fe315fee8f",
    "docs/test-reports/BL-WINDOWS-P1-STAGES-scope-20261009/verdict.json": "dded8038ca0715518b7086400c1f6e564fb0460416feb9254d0baabbe386b052",
    "docs/test-reports/windows-release-diagnosis-20261008/native-runtime-parity.mjs": "1030e91a2ea4dc2a9e81e876aa391ad19e401fb42c07d91435804d2da6f2603c",
    "docs/test-reports/windows-release-diagnosis-20261008/trace-preload.mjs": "76a820f66957bf34fb1b2064e673ffc7c2d666fc53e788fd1c6c5fb6ed999552",
    "src/cli/bounded-subprocess.ts": "26e8eef91284f151841fde3b6de50b90b218dfff38379d9acbda97c34caa7df7",
    "src/cli/bounded-subprocess-worker.mjs": "02a9f2701aa37a2b0fd02a195f1135c4f3e52aacc02aa0bf4c6356866f62efe3",
    "src/cli/replay.ts": "6fec39601d729bfe6c06c0d02d4d146bddbe80beeab92d1450b95db9d979cce8",
    ".github/workflows/windows-release-diagnostics.yml": "34915b1c93e8ee6bae6b7c55e682aeb2b41d36e544970a5d1e7a7df013d3bd0e",
    "package-lock.json": "7c0b9fcf3ae2a259f490bd754c0ee8871f01d2c120e731b5512629ad901a48e8",
}

SOURCE_HASHES = {
    WF: "94aa4fa7b31c49dacb71e2643976314351b7a9ad770b51a6e7d982a344bd962b",
    BM: "bf60ca426602d00b76515091cc30abd37badea21731b6ad21fe54cd323d7577c",
    BJ: "ed24ebf3b4b1890f84f09ba82edd0d71f75a12e35504a84a3fb0f9d8300455fc",
    CLI: "3a2d4174c1b2ac3b0caddb4b10c2ba9146c1569247dc6bd6084be01070a4346b",
    TESTS: "7718f1e6553f1f9bccca0520571727f2a712493ce789bb8a3f0898a75e289132",
}

result = {"checks": [], "errors": []}


def check(name, ok, detail=""):
    result["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    if not ok:
        result["errors"].append(f"{name}: {detail}")


def git(*args, binary=True):
    out = subprocess.run(
        ["git", "-c", "core.fileMode=false", *args],
        check=True, capture_output=True,
    ).stdout
    return out if binary else out.decode()


def sha256(b):
    return hashlib.sha256(b).hexdigest()


# --- commit identity -------------------------------------------------------
OWN_PREFIXES = ("docs/test-reports/BL-WINDOWS-P1-CHECKOUT-kimi-r0-20261011/",)
OWN_FILES = ("tests/evaluator/windows-p1-checkout-r0-checkout-env.test.ts",)
check("head_exact", git("rev-parse", "HEAD", binary=False).strip() == HEAD)
check("parent_exact", git("rev-parse", HEAD + "^", binary=False).strip() == PARENT)
porcelain = [l for l in git("status", "--porcelain", binary=False).splitlines()
             if l.strip()]
foreign = [l for l in porcelain
           if not any(l[3:].startswith(p) for p in OWN_PREFIXES)
           and not any(l[3:] == f for f in OWN_FILES)]
check("worktree_clean_besides_own_declared_artifacts", foreign == [],
      f"foreign={foreign} own={len(porcelain) - len(foreign)}")

# --- source888 file bytes and hashes ---------------------------------------
src = {p: git("show", f"{SRC}:{p}") for p in (WF, BJ, BM, CLI, TESTS)}
for p, want in SOURCE_HASHES.items():
    check(f"source_hash:{p}", sha256(src[p]) == want, sha256(src[p]))

head = {p: git("show", f"{HEAD}:{p}") for p in (WF, BJ, BM, CLI, TESTS)}

proposal = json.loads(open(
    "docs/test-reports/BL-WINDOWS-P1-CHECKOUT-plan-20261011/proposal.json").read())
cr = proposal["contract_revision_required"]
proj_want = cr["proposed_byte_hashes"]

# --- workflow projection ----------------------------------------------------
wd = proposal["selected_solution"]["workflow_delta"]
check("workflow_before_occurs_once", src[WF].count(wd["before"].encode()) == 1)
proj_wf = src[WF].replace(wd["before"].encode(), wd["after"].encode())
check("workflow_projected_hash", sha256(proj_wf) == proj_want["workflow"], sha256(proj_wf))
check("workflow_candidate_equals_projection", head[WF] == proj_wf)
check("workflow_candidate_hash", sha256(head[WF]) == proj_want["workflow"])
# line-level delta between source888 and candidate: exactly 4 added, 0 removed
diff_lines = list(difflib.unified_diff(
    src[WF].decode().splitlines(keepends=True),
    head[WF].decode().splitlines(keepends=True), n=0))
added = [l for l in diff_lines if l.startswith("+") and not l.startswith("+++")]
removed = [l for l in diff_lines if l.startswith("-") and not l.startswith("---")]
check("workflow_diff_exactly_4_added_0_removed",
      len(added) == 4 and len(removed) == 0,
      f"added={len(added)} removed={len(removed)}")
check("workflow_added_lines_exact",
      added == ["+        env:\n", "+          GIT_CONFIG_COUNT: '1'\n",
                "+          GIT_CONFIG_KEY_0: core.longpaths\n",
                "+          GIT_CONFIG_VALUE_0: 'true'\n"], repr(added))
check("workflow_candidate_minus_added_equals_source",
      "".join(l[1:] for l in added) == "" or
      head[WF].decode().replace("".join(l[1:] for l in added), "") == src[WF].decode())

# --- bindings JSON projection ------------------------------------------------
proj_bj = src[BJ]
for i, r in enumerate(cr["binding_json_replacements"]):
    b, a = r["before"].encode(), r["after"].encode()
    check(f"json_replacement_{i}_occurs_once_in_source_and_projection_input",
          proj_bj.count(b) == 1, f"count={proj_bj.count(b)}")
    proj_bj = proj_bj.replace(b, a)
check("json_projected_hash", sha256(proj_bj) == proj_want["bindings_json"], sha256(proj_bj))
check("json_candidate_equals_projection", head[BJ] == proj_bj)

src_bj = json.loads(src[BJ])
new_bj = json.loads(head[BJ])
changed_keys = {k for k in set(src_bj) | set(new_bj) if src_bj.get(k) != new_bj.get(k)}
check("json_only_allowed_top_level_keys_changed",
      changed_keys == {"revision", "updated_at_utc", "revision_scope",
                       "existing_file_edits_allowed", "workflow"},
      sorted(changed_keys))
wf_delta_keys = {k for k in set(src_bj["workflow"]) | set(new_bj["workflow"])
                 if src_bj["workflow"].get(k) != new_bj["workflow"].get(k)}
check("json_workflow_only_checkout_env_added",
      wf_delta_keys == {"checkout_env", "checkout_env_scope"}, sorted(wf_delta_keys))
check("json_checkout_env_exact_strings", new_bj["workflow"]["checkout_env"] == {
    "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.longpaths",
    "GIT_CONFIG_VALUE_0": "true"})
check("json_checkout_inputs_unchanged",
      new_bj["workflow"]["checkout"] == src_bj["workflow"]["checkout"])
for field in cr["binding_fields_not_changed"]:
    check(f"json_field_unchanged:{field}", src_bj.get(field) == new_bj.get(field))
check("json_sourceFiles_count_11", len(new_bj["native"]["sourceFiles"]) == 11
      if "native" in new_bj and "sourceFiles" in new_bj.get("native", {})
      else "sourceFiles-not-under-native-checked-separately")

# --- bindings MD projection ---------------------------------------------------
appendix = cr["binding_md_append"].encode()
proj_bm = src[BM] + appendix
check("md_projected_hash", sha256(proj_bm) == proj_want["bindings_md"], sha256(proj_bm))
check("md_candidate_equals_projection", head[BM] == proj_bm)
check("md_candidate_is_pure_append",
      head[BM].startswith(src[BM]) and head[BM][len(src[BM]):] == appendix)

# --- CLI projection -------------------------------------------------------------
old_bh = cr["cli_identity_replacements"][0]["old"].encode()
old_mh = cr["cli_identity_replacements"][1]["old"].encode()
new_bh = sha256(proj_bj).encode()
new_mh = sha256(proj_bm).encode()
check("cli_old_bindingHash_occurs_once", src[CLI].count(old_bh) == 1)
check("cli_old_mdHash_occurs_once", src[CLI].count(old_mh) == 1)
proj_cli = src[CLI].replace(old_bh, new_bh).replace(old_mh, new_mh)
check("cli_projected_hash", sha256(proj_cli) == proj_want["cli_hash_literals_only"],
      sha256(proj_cli))
check("cli_candidate_equals_projection", head[CLI] == proj_cli)
# mask only the two new literals in candidate: byte equality with source
masked = head[CLI].replace(new_bh, old_bh).replace(new_mh, old_mh)
check("cli_masked_candidate_equals_source888", masked == src[CLI])
check("cli_candidate_size_delta_exact",
      len(head[CLI]) == len(src[CLI]), f"{len(src[CLI])} -> {len(head[CLI])}")
# one-extra-byte negative on the exact-scope control itself
check("cli_mask_control_rejects_extra_byte", (head[CLI] + b"X").replace(
    new_bh, old_bh).replace(new_mh, old_mh) != src[CLI])

# --- tests unchanged -------------------------------------------------------------
check("tests_byte_identical", head[TESTS] == src[TESTS])
check("tests_hash", sha256(head[TESTS]) == SOURCE_HASHES[TESTS])

# --- frozen inputs at HEAD ---------------------------------------------------------
for p, want in FROZEN.items():
    got = sha256(git("show", f"{HEAD}:{p}"))
    check(f"frozen:{p}", got == want, got)

# --- tree records ---------------------------------------------------------------------
def ls_tree(sha, *extra):
    raw = git("ls-tree", "-rz", "--full-tree", *extra, sha)
    recs = {}
    for entry in raw.split(b"\0"):
        if not entry:
            continue
        meta, path = entry.split(b"\t", 1)
        recs[path.decode()] = meta.decode()
    return recs


def ls_tree_r(sha, *path):
    args = ["ls-tree", "-rz", "-r", "--full-tree", sha]
    if path:
        args += ["--", *path]
    return git(*args)


src_tree = ls_tree(SRC, "-r")
head_tree = ls_tree(HEAD, "-r")
check("source_tracked_paths_2453", len(src_tree) == 2453, len(src_tree))
allowed_diff = {WF, BJ, BM, CLI, *REPORT_ONLY}
only_src = set(src_tree) - set(head_tree)
only_head = set(head_tree) - set(src_tree)
changed = {p for p in set(src_tree) & set(head_tree) if src_tree[p] != head_tree[p]}
check("tree_no_deletions", only_src == set(), sorted(only_src))
check("tree_additions_exactly_4_report_only", only_head == set(REPORT_ONLY),
      sorted(only_head))
check("tree_modifications_exactly_4_source", changed == {WF, BJ, BM, CLI},
      sorted(changed))
check("tree_all_other_records_identical",
      all(src_tree[p] == head_tree[p] for p in set(src_tree) & set(head_tree)
          if p not in allowed_diff))

raw_src_full = ls_tree_r(SRC)
check("source_full_inventory_hash",
      sha256(raw_src_full) == "af29538927397b7ec48c261ca047616d9a18617a65f767165b61105d396d1a23",
      sha256(raw_src_full))
deep = ("docs/test-reports/windows-native-ci-20261008/"
        "runtime-parity-run-37822555762-original/windows-release-diagnostics-"
        "719c2df0d54f62b1b3b3e711a2045ffd8ea5e711/windows-release-diagnosis-"
        "20261008/native-output-parity-1791483248698")
sub = ls_tree_r(SRC, deep)
sub_head = ls_tree_r(HEAD, deep)
check("failed_subtree_55_paths", len([e for e in sub.split(b"\0") if e]) == 55,
      len([e for e in sub.split(b"\0") if e]))
check("failed_subtree_inventory_hash",
      sha256(sub) == "6cd55acce1fcd1a225edb9e96c2444c5f3a20f3ae38aaf3a6a2ffa1a78ac902f",
      sha256(sub))
check("failed_subtree_byte_identical_at_head", sub_head == sub)
arch = ("docs/test-reports/windows-native-ci-20261008/"
        "runtime-parity-run-37822555762-original")
arch_src = ls_tree_r(SRC, arch)
arch_head = ls_tree_r(HEAD, arch)
check("archive_root_57_paths_at_source",
      len([e for e in arch_src.split(b"\0") if e]) == 57,
      len([e for e in arch_src.split(b"\0") if e]))
check("archive_root_inventory_hash_at_source",
      sha256(arch_src) == "52ac3b835b45e6aa3c54ea72f57180421822c5719d2a9e9bca0d2abbbf0a0721",
      sha256(arch_src))
check("archive_tree_byte_identical_at_head", arch_head == arch_src)
enclosing_src = ls_tree_r(SRC, "docs/test-reports/windows-native-ci-20261008")
check("enclosing_dir_byte_identical_at_head",
      ls_tree_r(HEAD, "docs/test-reports/windows-native-ci-20261008") == enclosing_src)
longest = ("docs/test-reports/windows-native-ci-20261008/"
           "runtime-parity-run-37822555762-original/windows-release-diagnostics-"
           "719c2df0d54f62b1b3b3e711a2045ffd8ea5e711/windows-release-diagnosis-"
           "20261008/native-output-parity-1791483248698/"
           "downstream-off-confirmation.json")
check("longest_path_blob", src_tree.get(longest, "").endswith(
    "a3d877dca98202f202013de02e6731f026432da8"), src_tree.get(longest, ""))
check("longest_path_present_at_head", head_tree.get(longest) == src_tree.get(longest))

result["ok"] = not result["errors"]
result["summary"] = {"total": len(result["checks"]),
                     "passed": sum(1 for c in result["checks"] if c["ok"]),
                     "failed": len(result["errors"])}
json.dump(result, sys.stdout, indent=1)
print()
sys.exit(0 if result["ok"] else 1)
