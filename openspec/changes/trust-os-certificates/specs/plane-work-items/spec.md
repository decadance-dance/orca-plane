## ADDED Requirements

### Requirement: Trust the OS certificate store
Before its first request, the plugin SHALL add the certificates of the operating system's trust store to the roots its requests trust, keeping the runtime's bundled roots, and SHALL NOT otherwise relax certificate verification. When the runtime cannot read the OS store, or adding it fails, the plugin SHALL keep the default roots, log one line without any certificate, URL or token, and keep working.

#### Scenario: Self-hosted Plane behind a private CA
- **WHEN** the server's certificate is signed by a CA that the operating system trusts but the runtime's bundled roots do not
- **THEN** the request verifies and the connect proceeds as with a public certificate

#### Scenario: Certificate the OS does not trust either
- **WHEN** the server's certificate is expired, self-signed and not trusted by the OS, or issued for another host
- **THEN** the request is refused

#### Scenario: Runtime without the OS store API
- **WHEN** the runtime has no API to read the OS store, or reading it fails
- **THEN** the plugin logs one line, keeps the default roots, and works as before

### Requirement: Name an untrusted certificate
A request that fails because the server's certificate does not verify SHALL fail with an error that says the server's TLS certificate is not trusted and names the TLS error code, not with the network error.

#### Scenario: Certificate not trusted
- **WHEN** the server's certificate does not verify, such as an expired one
- **THEN** the error says the server's TLS certificate is not trusted, with the code such as `CERT_HAS_EXPIRED`

#### Scenario: Server not reachable
- **WHEN** the connection is refused or the host name does not resolve
- **THEN** the error says the Plane server could not be reached
