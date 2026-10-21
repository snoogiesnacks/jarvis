// The SSRF gate in front of every outbound request the bridge makes. Pure
// functions, no network: these must keep passing, because a regression here
// means a model-chosen URL can reach the user's LAN or cloud metadata.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blockedAddress, vetTarget, proxyError } from '../bridge/net.mjs'

test('blockedAddress refuses private, loopback and metadata addresses', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::',
    '::1',
    'fe80::1',
    'fd00::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
  ]) {
    assert.equal(blockedAddress(ip), true, `${ip} should be blocked`)
  }
})

test('blockedAddress allows ordinary public addresses', () => {
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111']) {
    assert.equal(blockedAddress(ip), false, `${ip} should be allowed`)
  }
})

test('blockedAddress treats malformed dotted-quad input as blocked', () => {
  for (const ip of ['999.1.1.1', '1.2.3', '1.2.3.4.5', '1.2.3.-4']) {
    assert.equal(blockedAddress(ip), true, `${ip} should be blocked`)
  }
})

// Known gap, recorded rather than fixed (no production-code change in this pass):
// empty/missing input falls through to the IPv6 tail and returns false (allowed).
// Not reachable today -- callers pass DNS answers and isIP()-validated literals --
// but a security gate should fail closed. Flip `todo` off once net.mjs does.
test('blockedAddress fails closed on empty or missing input', { todo: 'fail-open on empty input; unreachable from current callers' }, () => {
  for (const ip of ['', undefined, null]) {
    assert.equal(blockedAddress(ip), true, `${String(ip)} should be blocked`)
  }
})

test('vetTarget returns a URL for a normal public https address', () => {
  const url = vetTarget('https://example.com/a?b=1')
  assert.equal(url.hostname, 'example.com')
})

test('vetTarget answers 400 for anything that is not an absolute http(s) url', () => {
  for (const raw of ['ftp://example.com/x', 'file:///etc/passwd', 'not a url', '', undefined]) {
    assert.throws(() => vetTarget(raw), (err) => err.status === 400, `${String(raw)} should be 400`)
  }
})

test('vetTarget answers 403 for local and private targets', () => {
  for (const raw of [
    'http://localhost:8787/health',
    'http://printer.local/',
    'http://nas.internal/',
    'http://127.0.0.1/',
    'http://2130706433/', // decimal form of 127.0.0.1
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://169.254.169.254/latest/meta-data',
    'http://192.168.0.1/admin',
  ]) {
    assert.throws(() => vetTarget(raw), (err) => err.status === 403, `${raw} should be 403`)
  }
})

test('proxyError carries the status for the caller', () => {
  const err = proxyError(418, 'teapot')
  assert.equal(err.status, 418)
  assert.equal(err.message, 'teapot')
})
