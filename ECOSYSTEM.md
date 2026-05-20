# Ecosystem

This document defines official Neutrx ecosystem status, integration rules, naming expectations, and plugin security expectations. Neutrx is licensed under the MIT License.

## Official Package Status

The official package is `neutrx` as published or approved by the project maintainers. Any other package, plugin, integration, wrapper, fork, mirror, or distribution is unofficial unless the project maintainers give written permission.

## Official Repository Status

The official repository is the repository identified in the package metadata and project documentation.

Do not present a fork, mirror, copy, or modified release as official without written permission.

## Plugin And Addon Policy

Plugins and addons may be proposed through pull requests or issues when they:

- Preserve Neutrx security defaults.
- Avoid secret leakage.
- Avoid disabling SSRF protection for untrusted URLs.
- Include tests and documentation.
- Avoid unnecessary runtime dependencies.
- Follow project license and contribution rules.

Maintainers decide whether a plugin or addon belongs in the official project.

## Unofficial Integrations Policy

Unofficial integrations may describe compatibility with Neutrx only when accurate and not confusing. They must not:

- Copy or redistribute restricted project code without permission.
- Imply official status.
- Use confusing package names.
- Use Neutrx branding as the primary name of a separate project.
- Claim endorsement, certification, or release authority.
- Weaken security guidance for users.

Third-party packages must not use confusing names or imply official status without written permission.

## Name And Trademark Usage

Use the Neutrx name only to identify compatibility or contribution context. Do not use the name, logo, package identity, or project branding in a way that suggests ownership, endorsement, or official status without written permission.

Allowed descriptive wording:

- "Integration for Neutrx"
- "Works with Neutrx"
- "Example using Neutrx"

Not allowed without written permission:

- Names that appear to be official packages.
- Names that imply ownership by the Neutrx maintainers.
- Rebranded or modified releases.
- Package names that can confuse users about source or authority.

## Security Expectations For Plugins

Plugins and integrations should:

- Keep SSRF protections active by default.
- Preserve private IP and cloud metadata blocking for untrusted URLs.
- Preserve redirect header stripping.
- Preserve strict-mode HTTPS downgrade protection.
- Avoid logging secrets, tokens, cookies, request bodies, or raw errors.
- Respect body size limits.
- Avoid unsafe dynamic code loading.
- Document any security tradeoff clearly.

Security-sensitive plugins require maintainer review before official status is considered.
