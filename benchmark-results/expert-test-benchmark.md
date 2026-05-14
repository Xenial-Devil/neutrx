# Expert Test Benchmark

Date: 2026-05-14
Repository: neutrx
Git commit: 6db21a4
Node: v25.8.2
npm: 11.11.1

## Verdict

PASS

Full CI benchmark completed successfully with exit code 0.

## Command

```powershell
npm run ci
```

The logged run used a repo-local npm cache at `.npm-cache` to avoid OS permission errors from the default npm cache path during log capture.

## Results

- Lint: PASS
- Typecheck: PASS
- Build: PASS
- Test compile: PASS
- Test run: 45 pass, 0 fail, 0 skipped, 6660.6715 ms
- Coverage test run: 45 pass, 0 fail, 0 skipped, 6980.3292 ms
- Package validation: PASS (`Package neutrx@1.0.0 validates.`)
- End-to-end elapsed time: 74081 ms

## Coverage Headline

| Scope | Line % | Branch % | Function % |
| --- | ---: | ---: | ---: |
| all files | 47.85 | 61.26 | 39.08 |

## Artifacts

- Raw log: `benchmark-results/expert-test-benchmark.raw.log`
- Summary: `benchmark-results/expert-test-benchmark.md`
