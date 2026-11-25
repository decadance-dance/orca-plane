// Adds the OS certificate store to the roots the worker's fetch trusts, so a self-hosted Plane behind a
// private CA (one the person's OS already trusts) verifies. Orca starts plugin workers with a fixed
// environment and no Node flags, so NODE_EXTRA_CA_CERTS and --use-system-ca never reach them (#89).
// Verification stays on: only certificates the OS trusts are added, and Node's bundled roots are kept.

/** The part of `node:tls` this needs; both functions are missing before Node 22.19 / 23.5. */
export type TlsApi = {
  getCACertificates?: (type?: 'default' | 'system' | 'bundled' | 'extra') => string[]
  setDefaultCACertificates?: (certs: string[]) => void
}

export type TrustResult = { ok: true; added: number } | { ok: false; reason: string }

/** Never throws: on any failure the default roots stay as they were. */
export function addSystemCertificates(tls: TlsApi): TrustResult {
  try {
    if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
      return { ok: false, reason: 'this runtime cannot read the OS certificate store' }
    }
    const current = tls.getCACertificates('default')
    const known = new Set(current.map((pem) => pem.trim()))
    const added = tls.getCACertificates('system').filter((pem) => {
      const key = pem.trim()
      if (known.has(key)) return false
      known.add(key)
      return true
    })
    if (added.length > 0) tls.setDefaultCACertificates([...current, ...added])
    return { ok: true, added: added.length }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

let loaded: Promise<TrustResult> | undefined

// Dynamic, as in agents.ts: the plugin has no Node typings, and a host that refuses `node:tls`
// must leave the worker running with the default roots instead of failing its load.
const importTls = async (): Promise<TlsApi> => (await import('node:tls' as string)) as TlsApi

/** Once per worker process; resolves (never rejects) when the roots are set or left alone. `load` is for tests. */
export function trustSystemCertificates(log: (line: string) => void, load: () => Promise<TlsApi> = importTls): Promise<TrustResult> {
  loaded ??= (async () => {
    let result: TrustResult
    try {
      result = addSystemCertificates(await load())
    } catch (error) {
      result = { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    if (!result.ok) {
      try {
        log(`Plane: kept the default TLS roots, OS certificate store not added: ${result.reason}`)
      } catch {
        // A log that fails must not stop the worker.
      }
    }
    return result
  })()
  return loaded
}

/** For the real fetch: waits for a set-up already started, so no request races it. */
export function certificatesSettled(): Promise<unknown> {
  return loaded ?? Promise.resolve()
}

/** Tests only: forget the set-up, so the next call starts over. */
export function resetTrustForTests(): void {
  loaded = undefined
}
