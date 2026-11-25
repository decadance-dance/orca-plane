## Context

Orca forks the plugin host with an environment built from an allowlist (PATH, HOME, LANG, TZ, TMPDIR, ...), `ELECTRON_RUN_AS_NODE=1` and an empty `execArgv`. Node's own ways to trust more roots (`NODE_EXTRA_CA_CERTS`, `NODE_USE_SYSTEM_CA=1`, `--use-system-ca`) therefore never reach the worker. Node 22.19 / 23.5 added `tls.getCACertificates(type)` and `tls.setDefaultCACertificates(certs)`; Orca 1.4.273 runs Node 24.

## Decisions

### T1. Add the OS store at start-up
`activate` starts `trustSystemCertificates`: it imports `node:tls`, reads `getCACertificates('default')` and `getCACertificates('system')`, and, when the OS store holds certificates not already in the defaults, sets the defaults to the bundled ones followed by those (deduplicated by their PEM text). The real fetch in `src/plane/http.ts` awaits this set-up, so no request races it. It runs once per worker process.

### T2. Never fail the worker
Missing functions, a refused `node:tls` import, a throwing store read or a refused PEM leave the defaults as they were; the worker logs one line (`orca.log`) with the reason and works as before. The log line holds no certificate, URL or token.

### T3. Verification stays on
No `rejectUnauthorized`, no per-request `ca`, no host exceptions. The OS store's roots are added on top of Node's bundled roots, so the result is their union, not the OS's trust policy: a root the OS distrusts or removes but Node bundles is still trusted, as it was before this change, and OS-specific constraints on a root (such as limits on what it may sign) are not applied. A private CA is trusted only if the OS already trusts it.

### T4. Name a certificate failure
`fetch` rejects with a `TypeError` whose `cause` carries the TLS code. The error and up to two levels of `cause` are checked against a fixed list of certificate verification codes (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `SELF_SIGNED_CERT_IN_CHAIN`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `CERT_HAS_EXPIRED`, `ERR_TLS_CERT_ALTNAME_INVALID`, ...). A match gives `PlaneError('certificate', "The server's TLS certificate is not trusted (<code>).")`; only the listed code reaches the message, never other error text, the URL or the headers. Anything else stays `network`.

## Risks / Trade-offs

- A root the OS trusts but the person did not mean for Plane is trusted too; the person chose it by trusting the root in the OS.
- Setting the default roots affects every TLS connection of the worker process; the plugin's worker makes requests only to Plane.
