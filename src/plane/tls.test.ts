import { assert, test } from 'orca/testing'
import { addSystemCertificates, type TlsApi } from './tls'

const BUNDLED = ['-----BEGIN CERTIFICATE-----\nBUNDLED-A\n-----END CERTIFICATE-----\n', '-----BEGIN CERTIFICATE-----\nBUNDLED-B\n-----END CERTIFICATE-----\n']
const PRIVATE_CA = '-----BEGIN CERTIFICATE-----\nHOME-ROOT-CA\n-----END CERTIFICATE-----\n'

/** A stand-in for node:tls that records what the worker sets as the default roots. */
function fakeTls(system: string[]) {
  const set: string[][] = []
  const tls: TlsApi = {
    getCACertificates: (type) => (type === 'system' ? system : type === 'default' ? BUNDLED : []),
    setDefaultCACertificates: (certs) => void set.push(certs)
  }
  return { tls, set }
}

test('adds the OS store to the default roots and keeps the bundled ones', () => {
  const { tls, set } = fakeTls([PRIVATE_CA])
  assert.deepEqual(addSystemCertificates(tls), { ok: true, added: 1 })
  assert.deepEqual(set, [[...BUNDLED, PRIVATE_CA]])
})

test('adds each OS certificate once, and leaves the roots alone when it has nothing new', () => {
  const twice = fakeTls([PRIVATE_CA, PRIVATE_CA.trim(), BUNDLED[0]])
  assert.deepEqual(addSystemCertificates(twice.tls), { ok: true, added: 1 })
  assert.deepEqual(twice.set, [[...BUNDLED, PRIVATE_CA]])

  const none = fakeTls([BUNDLED[1]])
  assert.deepEqual(addSystemCertificates(none.tls), { ok: true, added: 0 })
  assert.deepEqual(none.set, [])
})

test('a runtime without the API is refused quietly, without throwing', () => {
  const result = addSystemCertificates({})
  assert.equal(result.ok, false)
  const half = addSystemCertificates({ getCACertificates: () => [PRIVATE_CA] })
  assert.equal(half.ok, false)
})

test('a throwing store or setter never escapes, and the roots stay unchanged', () => {
  const reading = addSystemCertificates({
    getCACertificates: (type) => {
      if (type === 'system') throw new Error('keychain unavailable')
      return BUNDLED
    },
    setDefaultCACertificates: () => assert.fail('must not set roots after a failed read')
  })
  assert.deepEqual(reading, { ok: false, reason: 'keychain unavailable' })

  const setting = addSystemCertificates({
    getCACertificates: (type) => (type === 'system' ? [PRIVATE_CA] : BUNDLED),
    setDefaultCACertificates: () => {
      throw new Error('bad PEM')
    }
  })
  assert.deepEqual(setting, { ok: false, reason: 'bad PEM' })
})
