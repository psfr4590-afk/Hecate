# HECATE release candidate checklist

This document is the release gate for HECATE. A release candidate is not considered deployment-ready merely because the application starts on a developer machine.

## Required repository state

- package.json and package-lock.json carry the same release-candidate version.
- .nvmrc identifies the supported Node.js runtime.
- engine-strict=true prevents installation on an unsupported Node.js engine.
- Runtime credentials, databases, evidence, logs, and private keys remain excluded from source control.
- The working tree is tested from the repository root with a clean dependency install.

## Automated release gate

Required checks:

    npm ci
    npm run verify:release
    npm audit --omit=dev --audit-level=high
    npm run smoke:start
    npm test
    npm run check:encoding
    npm run build:ui
    npm pack --dry-run

The GitHub regression workflow executes the verification and regression gates on pushes and pull requests targeting main.

## Clean-machine deployment proof

From a fresh checkout:

    git clone https://github.com/psfr4590-afk/Hecate.git
    cd Hecate
    npm ci
    npm start

Verify the health endpoint at http://127.0.0.1:7331/health, then verify the authenticated operator console and all seven module workspaces through the documented local operator path.

Runtime state must remain outside the repository.

## Release artifact

Release tags must exactly match the package version:

    package.json: 1.0.0-rc.N
    Git tag:       v1.0.0-rc.N

The release workflow verifies the tag/version match, reruns the complete release gate, creates the deployment package, and records a SHA-256 checksum.

## Release blockers

Do not publish a release candidate when any of the following are true:

- CI regression is failing.
- npm ci cannot reproduce the dependency tree.
- The release invariant check fails.
- The clean-start smoke test fails.
- The full regression suite fails.
- The production UI build fails.
- A high-severity production dependency audit finding remains unresolved.
- Runtime secrets or engagement data are present in the repository.
- The release tag does not match the package version.

Known architectural limits documented in README.md are not automatically release blockers when they remain intentional, tested, and accurately documented.
