import { assert, test } from 'orca/testing'
import { browseUrl, NOT_A_REF, NOT_THIS_WORKSPACE, normalizeServer, normalizeSlug, parseItemRef } from './url'

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

const CLOUD_CONN = { appBase: 'https://app.plane.so', slug: 'acme' }
const PREFIXED = { appBase: 'https://plane.example.org/tools/plane', slug: 'acme' }
const PROJECT = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b'
const ISSUE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

test('parseItemRef: a key in any case, upper-cased', () => {
  assert.deepEqual(parseItemRef(' diogen-12 ', CLOUD_CONN), { key: 'DIOGEN-12' })
})

test('parseItemRef: a Cloud browse URL, with or without its trailing slash', () => {
  assert.deepEqual(parseItemRef('https://app.plane.so/acme/browse/DIOGEN-12/', CLOUD_CONN), { key: 'DIOGEN-12' })
  assert.deepEqual(parseItemRef('https://app.plane.so/acme/browse/diogen-12?x=1#y', CLOUD_CONN), { key: 'DIOGEN-12' })
})

test('parseItemRef: a self-hosted URL under a path prefix round-trips from browseUrl', () => {
  assert.deepEqual(parseItemRef(browseUrl(PREFIXED.appBase, 'acme', 'DIOGEN-12'), PREFIXED), { key: 'DIOGEN-12' })
})

test('parseItemRef: the same slug under another prefix, another slug or another origin is refused', () => {
  for (const [text, conn] of [
    ['https://plane.example.org/acme/browse/DIOGEN-12/', PREFIXED],
    ['https://plane.example.org/other/plane/acme/browse/DIOGEN-12/', PREFIXED],
    ['https://app.plane.so/other/browse/DIOGEN-12/', CLOUD_CONN],
    ['https://app.plane.so/acmex/browse/DIOGEN-12/', CLOUD_CONN],
    ['https://evil.example.com/acme/browse/DIOGEN-12/', CLOUD_CONN],
    ['http://app.plane.so/acme/browse/DIOGEN-12/', CLOUD_CONN]
  ] as const) {
    assert.deepEqual(parseItemRef(text, conn), { reason: NOT_THIS_WORKSPACE }, text)
  }
})

test('parseItemRef: a project-issue URL gives the project and item ids', () => {
  assert.deepEqual(parseItemRef(`https://app.plane.so/acme/projects/${PROJECT}/issues/${ISSUE}/`, CLOUD_CONN), {
    projectId: PROJECT,
    id: ISSUE
  })
})

test('parseItemRef: garbage and other pages of the workspace are refused', () => {
  for (const text of ['', 'hello', 'DIOGEN', 'DIOGEN-', '12', 'ftp://app.plane.so/acme/browse/D-1/', 'https://app.plane.so/acme/projects/', `https://app.plane.so/acme/projects/${PROJECT}/issues/`, 'https://app.plane.so/acme/browse/DIOGEN-12/extra/']) {
    assert.deepEqual(parseItemRef(text, CLOUD_CONN), { reason: NOT_A_REF }, text)
  }
})

test('review 1: a malformed percent escape is refused, not thrown', () => {
  assert.deepEqual(parseItemRef('https://app.plane.so/acme/browse/%ZZ/', CLOUD_CONN), { reason: NOT_A_REF })
})
