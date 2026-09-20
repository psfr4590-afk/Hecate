# Security Policy

HECATE is a local-first security assessment and red-team operations platform intended for authorized engagements.

## Reporting a vulnerability

Do not open a public GitHub issue for a vulnerability that could expose credentials, session material, captured evidence, or an exploitable security flaw.

When reporting a security issue, include:

- A concise description of the affected component
- The affected version or commit
- Reproduction steps using synthetic or non-sensitive data
- The expected and observed behavior
- Any relevant logs or stack traces with secrets removed
- Your assessment of impact, if known

Please do not include real client data, credentials, private keys, session tokens, captured traffic, or other sensitive engagement material.

## Scope

Security reports are especially useful for issues involving:

- Authentication or authorization bypass
- Engagement-scope isolation failures
- Secret or credential exposure
- Browser-session or WebSocket security
- Cryptographic misuse
- Audit-chain integrity
- Runtime-data leakage
- Unsafe handling of assessment evidence

The project is explicitly single-operator and single-process. Direct database administrators can bypass application-level controls, and MITM DNS runtime state is process-global. Those documented architectural boundaries are not, by themselves, vulnerabilities.

## Authorized use

HECATE is for authorized security testing. Test only systems, accounts, networks, and data for which you have explicit permission.
