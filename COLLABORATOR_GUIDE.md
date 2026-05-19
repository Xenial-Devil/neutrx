# Collaborator Guide

This guide is for Neutrx maintainers and trusted collaborators. Neutrx is source-available under a restrictive project license. Collaboration must protect users, project reputation, release integrity, and license boundaries.

## Collaborator Responsibilities

Collaborators are expected to:

- Review contributions with technical care and professional tone.
- Protect secure defaults and documented security profiles.
- Keep public APIs stable unless a breaking change is approved.
- Require tests and documentation for behavior changes.
- Respect maintainer decisions on scope, roadmap, releases, branding, and license permissions.
- Avoid conflicts of interest when reviewing external contributions.
- Escalate security, legal, publishing, or license questions to the project owner.

## Review Rules

- Require clear problem statements and focused pull requests.
- Review security-sensitive code with extra care.
- Confirm tests cover new behavior and regressions.
- Check that documentation matches implementation.
- Ask for smaller changes when review scope becomes too broad.
- Do not approve changes that weaken security defaults without explicit owner approval.
- Do not approve package name, branding, license, workflow, or publishing changes without owner approval.

## Branch Protection Expectations

Protected branches should require:

- Pull request review before merge.
- Passing CI checks.
- No force pushes.
- Auditable history based on repository policy.
- Branch updates before merge when required by CI.
- Maintainer approval for release, workflow, package, and security policy changes.

Direct commits to protected branches should be limited to urgent owner-approved maintenance.

## Release Approval Rules

- No direct publishing without owner approval.
- Releases require passing validation, tests, build, package checks, and documentation review.
- Release notes must describe user-visible changes and security impact when relevant.
- Package contents must be reviewed before publishing.
- Version changes must match project release policy.
- Publishing credentials and platform permissions must remain limited to approved maintainers.

## Security Issue Handling

- Treat vulnerability reports as private by default.
- Do not move private report details into public issues before maintainer approval.
- Limit access to people needed for triage and repair.
- Confirm reproduction before assigning severity.
- Prepare tests or proof checks when safe.
- Coordinate advisory, release, and disclosure timing with the project owner.

## Dependency Update Handling

- Review dependency purpose, provenance, license compatibility, maintainer activity, and install behavior.
- Prefer no new runtime dependencies unless the owner accepts the tradeoff.
- Run tests, typecheck, build, and package validation after dependency updates.
- Prioritize security updates, but do not bypass review.
- Document user-facing changes caused by dependency updates.

## Documentation Review

Documentation changes should be reviewed for:

- Accuracy against current behavior.
- Clear Node.js >=22 support language.
- Security profile guidance using `strict`, `standard`, and `legacy`.
- Correct source-available and restrictive license language.
- No unsupported publishing, redistribution, selling, rebranding, or modified release claims.
- No confusing claims about official integrations or ecosystem status.

## Test Requirements Before Merge

Before merge, require applicable checks:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run validate` for broad changes
- Security-focused tests for URL, DNS, redirect, header, TLS, body-size, and redaction changes
- Retry, cache, circuit breaker, and interceptor tests for resilience or behavior changes

Maintainers may approve documentation-only changes with reduced test scope when no executable behavior changes.

## License And Fork Boundaries

Forks are allowed only for contribution back to the original repository. Publishing, redistributing, selling, rebranding, sublicensing, or releasing modified versions is not allowed without written permission from the project owner.
