# tokenizer internal braces backport

This directory starts from the exact npm `braces@3.0.3` tarball and carries an
internal, reviewable mitigation for GHSA-vfj7-8cjw-p6xm. It is not an upstream
release and must not be represented as an official fix.

## Source and review status

- npm tarball: `https://registry.npmjs.org/braces/-/braces-3.0.3.tgz`
- npm integrity: `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`
- tarball SHA-256: `1cd18e862c8640b4568b1425a7df4ee030ff201d45b2da8f9f222d2987494ffc`
- upstream reference: `micromatch/braces#78`, head
  `97308a01d091b211cf015314a2d0696da28a5392`
- upstream status captured 2026-10-08: open and unmerged

The original MIT `LICENSE` is preserved byte-for-byte. `PATCH-MANIFEST.json`
records the pristine and patched hashes. The complete source diff is stored at
`docs/test-reports/B02-braces-backport-generator-20261008/evidence/internal-backport.patch`.

## Local changes

- A mandatory maximum of 100 nested containers is enforced while parsing both
  braces and parentheses.
- Recursive direct-AST traversal in `compile`, `expand`, and `stringify` checks
  the same bound, so callers cannot bypass the parser guard.
- Depth 100 is accepted; depth 101 is rejected with `SyntaxError` and code
  `ERR_BRACES_MAX_DEPTH`.
- Walkers count nodes that contain a `nodes` array. This local boundary rule is
  intentionally narrower than the current PR #78 draft, which counts terminal
  recursive calls and can reject a leaf below 100 containers.
- Upstream development-only dependencies were removed from this vendored
  `package.json`. npm treats a repository-local `file:` dependency as a linked
  root package and would otherwise install braces' old Mocha/Gulp toolchain.
  Runtime dependency metadata and the package version remain unchanged.

The repository declares `braces` as `file:vendor/braces` and uses npm's
`$braces` override reference. This keeps every transitive consumer on this
checked-in source without a mutable Git URL.

## Security and release boundary

`npm audit` reports registry advisory metadata by package identity and install
shape; a lower count or a zero count would not prove this internal patch is
correct or upstream-approved. Conversely, retaining version `3.0.3` can leave
the advisory visible even when the guarded code is installed. The authoritative
candidate evidence is the source diff, exact hashes, negative controls, boundary
tests, compatibility probes, and independent security review.

Remove this backport only after an upstream release is independently verified
to guard parser input and direct AST calls to all three recursive walkers.
