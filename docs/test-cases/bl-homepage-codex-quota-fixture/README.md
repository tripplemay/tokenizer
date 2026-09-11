# Evaluator UI evidence replay

The HTML/CSS and `fixture.test.ts.txt` are copied byte-for-byte from the independent Kimi evaluator worktree. Screenshots and its unchanged verdict/signoff are under `docs/test-reports/`.

The original fixture generator requires an existing `.next/static/css` directory and records the three CSS filenames from the evaluated build. It is an explicit UI-artifact generator, not an unconditional unit test. It is archived as `.txt` outside Vitest's default discovery so `npm test` on a fresh checkout does not require a preceding production build or regenerate committed artifacts. The separate eight evaluator probes remain normal tests under `tests/evaluator/`.

To replay the captured UI without rebuilding, serve this directory on loopback:

```sh
python3 -m http.server 8797 --bind 127.0.0.1 --directory docs/test-cases/bl-homepage-codex-quota-fixture
```

Open `http://127.0.0.1:8797/index.html` or `zh-CN.html`; inspect the native details control at 1280px and 375px. Stop the server afterwards. The fixture uses a frozen clock and synthetic accounts, not live quota data.

To regenerate the same evaluated fixture, use a scratch checkout of `d6bc7f4e4e565329adb3f08f20aea6df3e8ad7fc` with the same locked dependencies, run `npm run build`, restore `fixture.test.ts.txt` as `tests/evaluator/bl-homepage-codex-quota-fixture.test.ts`, then run that file explicitly with Vitest. Check the generated HTML stylesheet links against the actual compiled CSS names; the archived generator is an exact historical artifact, not a generic future-build script.

This packaging note is from the Coordinator, not an amendment of the Evaluator's conclusions. The original evaluator worktree and generator remain intact.
