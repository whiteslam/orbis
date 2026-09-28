import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isAlertMail, senderAddress, senderName } from './important-filter';

const person = { from: 'Asha Rao <asha@example.com>', subject: 'Contract for next week' };

test('mail from a person is kept', () => {
  assert.equal(isAlertMail(person), false);
});

test('bank and card alerts are dropped', () => {
  assert.equal(isAlertMail({ from: 'HDFC Bank <alerts@hdfcbank.net>', subject: 'You have done a UPI txn' }), true);
  assert.equal(isAlertMail({ from: 'Bank <care@bank.example>', subject: 'Rs 450.00 debited from your A/c' }), true);
  assert.equal(isAlertMail({ from: 'Card <cards@bank.example>', subject: 'Your account statement for September' }), true);
});

test('OTPs and sign-in notices are dropped', () => {
  assert.equal(isAlertMail({ from: 'Service <help@service.example>', subject: 'Your OTP is 482913' }), true);
  assert.equal(isAlertMail({ from: 'Google <no-reply@accounts.google.com>', subject: 'Security alert' }), true);
});

test('automated senders and newsletters are dropped', () => {
  assert.equal(isAlertMail({ from: 'noreply@shop.example', subject: 'Order shipped' }), true);
  assert.equal(isAlertMail({ ...person, listUnsubscribe: '<mailto:unsub@example.com>' }), true);
  assert.equal(isAlertMail({ ...person, precedence: 'bulk' }), true);
  assert.equal(isAlertMail({ ...person, autoSubmitted: 'auto-generated' }), true);
  assert.equal(isAlertMail({ ...person, autoSubmitted: 'no' }), false);
});

test('sender parts are read out of the From header', () => {
  assert.equal(senderAddress('Asha Rao <Asha@Example.com>'), 'asha@example.com');
  assert.equal(senderName('"Asha Rao" <asha@example.com>'), 'Asha Rao');
  assert.equal(senderName('asha@example.com'), 'asha@example.com');
});
