# Tasks

## 1. Roots

- [x] 1.1 `src/plane/tls.ts`: `addSystemCertificates` and `trustSystemCertificates` (T1, T2); `activate` starts it; the real fetch awaits it. Verify: `src/plane/tls.test.ts` covers the OS store added after the bundled roots, deduplication, no change when nothing is new, a runtime without the API, and a throwing read or setter (no throw, roots unchanged).
- [x] 1.2 Live check from Orca's runtime (`ELECTRON_RUN_AS_NODE=1` Orca binary with a cleared environment): a server behind a CA in the OS store answers (HTTP 401 without a token) with the set-up and fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` without it; `https://expired.badssl.com/` and `https://self-signed.badssl.com/` are still refused with it.

## 2. Error

- [x] 2.1 `src/plane/http.ts`: the `certificate` kind (T4). Verify: `src/plane/http.test.ts` covers each listed code giving the certificate message, and `ECONNREFUSED`, `ENOTFOUND` and a bare `fetch failed` staying `network`.

## 3. Check

- [x] 3.1 `bin/check` exits 0; `openspec validate --all` passes.
