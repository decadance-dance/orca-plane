## Why

A self-hosted Plane whose certificate is signed by a private CA (a company or internal root that the person's OS already trusts) cannot be connected: Connect says "Could not reach the Plane server." (#89). Orca starts plugin workers with a fixed environment and no Node flags, so `NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA` and `--use-system-ca` never reach the plugin, and the person has no workaround. The message also points at the network instead of the certificate.

## What Changes

- At start-up, before its first request, the worker adds the certificates of the OS trust store to the roots its requests trust, keeping Node's bundled roots. On a runtime without the API, or on any failure, it logs one line and keeps the default roots.
- A request that fails because the server's certificate does not verify fails with a certificate error naming the TLS code ("The server's TLS certificate is not trusted (`<code>`)."), not as a network error.

Verification is not weakened: only certificates the OS already trusts are added; an expired, self-signed or wrong-host certificate is still refused.

## Capabilities

### New Capabilities

### Modified Capabilities

- `plane-work-items`: new requirements "Trust the OS certificate store" and "Name an untrusted certificate".

## Impact

- `src/plane/tls.ts` (new): the guarded set-up of the roots.
- `src/plane/http.ts`: the real fetch waits for the set-up; a `certificate` error kind.
- `src/worker.ts`: starts the set-up on activate.
- Tests: `src/plane/tls.test.ts` (new), `src/plane/http.test.ts`.
