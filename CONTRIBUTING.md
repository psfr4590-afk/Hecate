# Contributing to HECATE

Contributions should improve the reliability, clarity, security, or maintainability of the HECATE platform.

## Before submitting changes

1. Read the README and understand the current architecture and documented limits.
2. Keep changes within the existing engagement-scoped authorization model.
3. Use synthetic fixtures for tests.
4. Never commit real credentials, tokens, keys, client evidence, captured traffic, or runtime databases.
5. Preserve the distinction between implemented behavior and planned functionality.

## Validation

Run the relevant checks before opening a pull request:

```bash
npm test
npm run check:encoding
npm run build:ui
```

For focused work, also run the applicable core, API, module, phase, or end-to-end test command documented in the README.

## Pull requests

A useful pull request should explain:

- What changed
- Why the change is needed
- Which components are affected
- How the change was tested
- Any security, authorization, persistence, or compatibility implications

Keep capability claims proportional to what the code and tests actually demonstrate. Documentation should not advertise an execution path that is not implemented.

## Security-sensitive changes

For changes affecting authentication, authorization, cryptography, session handling, evidence, audit history, C2, Delivery, MITM, or credential storage, include regression coverage for the affected boundary where practical.

Use synthetic data in all repository tests and examples.
