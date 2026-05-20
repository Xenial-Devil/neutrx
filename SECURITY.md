# Security Policy

Neutrx is a security-first Node.js 22+ HTTP client. This policy explains supported runtime versions, vulnerability reporting, private disclosure expectations, security controls, and supply-chain handling.

## Supported Runtime

Neutrx supports:

- Node.js >=22

Unsupported runtimes do not receive security support. Security fixes target the maintained package line and the main development branch.

## Reporting A Vulnerability

Do not open a public issue, public discussion, social post, or public proof of concept for a suspected vulnerability.

Use GitHub private vulnerability reporting:

- https://github.com/Xenial-Devil/neutrx/security/advisories/new

Report privately to the project owner or maintainers with:

- Affected version or commit.
- Vulnerability type and impact.
- Reproduction steps.
- Minimal proof of concept, if safe to share privately.
- Any known workaround.
- Suggested fix, if known.

Maintainers will acknowledge valid reports as soon as practical, triage severity, prepare a fix, and coordinate disclosure timing based on impact.

## Private Disclosure Request

Please keep vulnerability details private until maintainers have reviewed the report and had reasonable time to release or document a mitigation. Public disclosure before maintainer review is not allowed.

## Security Features

Neutrx includes security controls intended for backend HTTP usage:

- SSRF protection.
- Private IP blocking.
- Cloud metadata blocking.
- Link-local and loopback blocking where configured.
- Redirect header stripping for sensitive headers.
- HTTPS downgrade protection in strict mode.
- Error redaction for secrets in URLs, headers, and response fields.
- Request body size limits.
- Response body size limits.
- Configurable allowed and denied hosts.
- Dangerous port blocking where configured.

## Security Profile Selection

Use the strictest profile that works for your deployment:

- `strict`: use for untrusted or user-controlled URLs and high-risk outbound traffic.
- `standard`: use for normal production service-to-service traffic.
- `legacy`: use only as a temporary bridge for trusted migrations, then move to `standard` or `strict`.

Do not use relaxed settings for untrusted URLs.

## Supply-Chain Security

Maintainers and collaborators should:

- Keep runtime dependencies minimal.
- Review dependency changes before merge.
- Prefer locked, reproducible installs.
- Run validation before release.
- Avoid long-lived publishing tokens where platform-supported trusted publishing is available.
- Review package contents before publishing.
- Reject dependency changes that add unclear provenance, unexpected install scripts, or excessive permission needs.

## Dependency Vulnerability Process

When dependency advisories affect Neutrx:

1. Confirm whether the vulnerable code path is reachable.
2. Check severity, exploitability, and affected versions.
3. Prepare an update or mitigation.
4. Run tests and package validation.
5. Document user action when required.

Security dependency updates may be expedited, but still require maintainer review.

## Disclosure Rules

- No public disclosure before maintainer review.
- No public exploit details before a fix or mitigation is available unless maintainers approve.
- No pressure campaigns around embargoed reports.
- Do not present an unofficial fork or patch as an official Neutrx security release.


