import { assert, test } from 'orca/testing'
import { browseUrl, normalizeServer, normalizeSlug } from './url'

const selfHosted = (serverUrl: string) => normalizeServer({ hostKind: 'self-hosted', serverUrl })

test('Plane Cloud uses the fixed API and app origins', () => {
  assert.deepEqual(normalizeServer({ hostKind: 'cloud' }), {
    ok: true,
    hostKind: 'cloud',
    apiBase: 'https://api.plane.so',
    appBase: 'https://app.plane.so'
  })
})

test('a Cloud URL in the self-hosted field means Cloud', () => {
  const urls = selfHosted('https://app.plane.so/truelogic/browse/DIOGEN-1/')
  assert.equal(urls.ok && urls.hostKind, 'cloud')
})

test('self-hosted keeps the origin and the install path, without a scheme too', () => {
  assert.deepEqual(selfHosted('plane.example.com'), {
    ok: true,
    hostKind: 'self-hosted',
    apiBase: 'https://plane.example.com',
    appBase: 'https://plane.example.com'
  })
  const prefixed = selfHosted('https://example.com/plane/')
  assert.equal(prefixed.ok && prefixed.apiBase, 'https://example.com/plane')
})

test('strips /api… and browser paths', () => {
  for (const raw of [
    'https://plane.example.com/api/v2/users/me/',
    'https://plane.example.com/api',
    'https://plane.example.com/my-team/projects/abc/issues/',
    'https://plane.example.com/my-team/browse/WEB-1/',
    'https://plane.example.com/sign-in'
  ]) {
    const urls = selfHosted(raw)
    assert.equal(urls.ok && urls.apiBase, 'https://plane.example.com', raw)
  }
})

test('refuses plain http off loopback, allows it on loopback', () => {
  assert.deepEqual(selfHosted('http://plane.example.com'), { ok: false, error: 'insecure' })
  for (const raw of ['http://localhost:8000', 'http://127.0.0.1:8000', 'http://[::1]:8000']) {
    const urls = selfHosted(raw)
    assert.ok(urls.ok, raw)
  }
})

test('refuses userinfo, other schemes and junk', () => {
  assert.deepEqual(selfHosted('https://me:pw@plane.example.com'), {
    ok: false,
    error: 'credentials_in_url'
  })
  assert.deepEqual(selfHosted('ftp://plane.example.com'), {
    ok: false,
    error: 'unsupported_protocol'
  })
  assert.deepEqual(selfHosted('  '), { ok: false, error: 'empty' })
  assert.deepEqual(selfHosted('https://'), { ok: false, error: 'invalid_url' })
})

test('slugs and the browse URL', () => {
  assert.equal(normalizeSlug(' TrueLogic '), 'truelogic')
  assert.equal(normalizeSlug('a/b'), null)
  assert.equal(normalizeSlug(''), null)
  assert.equal(
    browseUrl('https://app.plane.so', 'truelogic', 'DIOGEN-449'),
    'https://app.plane.so/truelogic/browse/DIOGEN-449/'
  )
})
