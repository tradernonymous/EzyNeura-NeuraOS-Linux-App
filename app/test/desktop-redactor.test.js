// The redactor (diagnostics.js) against Octop's PII bar (U48): every shape a
// credential or identifier takes in the wild must come out unusable, while
// ordinary diagnostics text passes through untouched. If a pattern below ever
// fails, the redactor regressed -- fix the redactor, never delete the case.
const test = require('node:test');
const assert = require('node:assert/strict');

const lib = require('../desktop/src/diagnostics.js');

function leaks(out) {
  return /hf_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY/.test(out);
}

test('hugging face tokens die in every position', () => {
  assert.ok(!leaks(lib.redact('token hf_abcDEF1234567890 here')));
  assert.ok(!leaks(lib.redact('hf_abcDEF1234567890')));
  assert.ok(!leaks(lib.redact('key=hf_abcDEF1234567890;')));
});

test('openai-style keys and bearer headers die', () => {
  assert.ok(!leaks(lib.redact('sk-abcdef1234567890abcdef')));
  assert.ok(!leaks(lib.redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload')));
  assert.ok(!leaks(lib.redact('bearer sk-abcdef1234567890abcdef')));
});

test('github tokens and aws keys die', () => {
  assert.ok(!leaks(lib.redact('ghp_abcdefghij1234567890abcdefghij12')));
  assert.ok(!leaks(lib.redact('AKIAIOSFODNN7EXAMPLE')));
  assert.ok(!leaks(lib.redact('-----BEGIN OPENSSH PRIVATE KEY-----')));
});

test('query strings never survive a url', () => {
  const out = lib.redactUrl('http://127.0.0.1:47831/chat?token=hf_abcDEF1234567890');
  assert.ok(!out.includes('?token=') && !leaks(out));
  assert.ok(out.startsWith('http://127.0.0.1:47831/chat'));
  assert.equal(lib.redactUrl('http://127.0.0.1:47831/health'), 'http://127.0.0.1:47831/health');
  assert.equal(lib.redactUrl(''), '');
});

test('ordinary diagnostics text passes through', () => {
  assert.equal(lib.redact('WebKitGTK 2.48.0 (dmabuf: on)'), 'WebKitGTK 2.48.0 (dmabuf: on)');
  assert.equal(lib.redact('log is 41 KB'), 'log is 41 KB');
  assert.equal(lib.redact(null), '');
});
