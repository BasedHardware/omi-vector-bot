const assert = require('node:assert/strict');
const test = require('node:test');
const { sslFor } = require('../db');

test('public Postgres checks the certificate, and the private Railway host does not need one', () => {
  assert.equal(sslFor('postgres://db.example.com/omi').rejectUnauthorized, true);
  assert.equal(sslFor('postgres://postgres.railway.internal:5432/railway'), false);
  assert.equal(sslFor('postgres://localhost/omi'), false);
});
