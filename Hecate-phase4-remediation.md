# HECATE PHASE 4 REMEDIATION

## Historical scope

Phase 4 closed the API authentication boundary verification gap identified after Phases 1–3 and added transport-level WebSocket hardening.

This document is a historical remediation record. It describes what Phase 4 changed; it is not the current application reference. The current UI and runtime model are summarized at the end of this document and in `README.md`.

Credential contents, encryption keys, token material, implant keys, and active attack/exploitation behavior were not changed.

## Completed

### 1. Fixed the `/api/v1` authentication mounting defect

Authentication was previously mounted at a different Express prefix from the actual API router. Phase 4 mounts the authentication middleware directly on `/api/v1`.

This protects the actual REST API, including `/api/v1/status` and all mounted core/module routes, while `/health` remains intentionally public.

### 2. Removed WebSocket query-string token authentication

WebSocket authentication no longer accepts `?token=` URL authentication. Query strings can leak into browser history, proxy/access logs, telemetry, and other infrastructure logs.

WebSocket authentication uses request headers instead.

### 3. Added a WebSocket inbound payload ceiling

The WebSocket server defaults to a 64 KiB maximum inbound message size, with an explicit `maxPayload` option for deployments that require another bound.

### 4. Added Phase 4 API/WebSocket regression coverage

Phase 4 added coverage for:

- public health access;
- unauthenticated `/api/v1` rejection;
- authenticated `/api/v1` access;
- rejection of WebSocket query-string token authentication;
- header-based WebSocket authentication extraction.

## Current application relationship

The Phase 4 authentication changes remain part of the current application.

The current local console is served by the same HECATE process and authenticates through an HttpOnly, SameSite browser session cookie. Programmatic API clients can use the configured bearer token or `X-Hecate-Token` header.

The current console provides workspaces for Dashboard, Engagements, Targets, Findings, Evidence, Sessions, and Audit Log. Module cards are presented from the live module registration status. Only Recon and Web Application Assessment currently expose active launch controls in the console; the other registered modules remain API-backed without dedicated UI launch controls.

The current application is intentionally single-operator and local-first. It is not a multi-operator IAM system.

## Explicitly not changed

- `core/store/credential-store.js`
- credential plaintext/encrypted formats
- HECATE encryption-key handling
- API token generation/storage/material
- implant key generation/storage/decryption
- C2 wire encryption
- active attack/exploitation behavior

## Residual architectural limitations

- HECATE uses a single configured process operator rather than a full multi-user IAM system.
- C2 replay protection remains the existing ciphertext replay model rather than a new monotonic sequence/nonce protocol.
- Audit integrity is application/database-layer append-only plus hash-chain verification and does not protect against a database administrator with direct database authority.
- WebSocket engagement isolation depends on event scope metadata; Phase 5 subsequently changed engagement-sensitive event handling to fail closed when that metadata is missing.

## Validation record

The original Phase 4 validation recorded syntax success for changed JavaScript and a passing non-API regression suite. The isolated materialized archive used during that historical pass did not contain its installed Express/WebSocket dependency tree, so full API/WebSocket integration execution was dependency-limited.

Current repository test commands are defined in `package.json`; use `npm test` after installing the repository dependencies rather than relying on the historical validation counts in this document.
