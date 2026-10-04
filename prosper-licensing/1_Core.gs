/**
 * Prosper licensing on Google Apps Script: sell by bank transfer, issue PINs, activate licences. Free, no server, no card.
 *
 * What it does (the same job as core/bank_transfer.py + core/activation_server.py, inside your own Google account):
 *   1. A customer opens the Web App link, picks a plan and gets an exact amount to send to your bank account (plan price + 1..99 cents).
 *   2. Your bank (Grey) emails you "money received". Every minute this script reads those emails from YOUR Gmail inbox, checks the mail is
 *      genuinely from the bank (sender domain + a DKIM pass that Gmail recorded), and matches the amount to an open order.
 *   3. It emails the customer their PIN and emails YOU that a sale happened.
 *   4. Prosper installs call this Web App to activate a PIN (signed licence token, RS256) and to re-check it every 72 hours.
 *
 * SET UP: see README.md in this folder. Everything secret lives in Project Settings > Script properties, never in this file.
 *
 * Script properties:
 *   LICENSE_PRIVATE_KEY   PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----"), the key whose public half is core/license_public_key.pem
 *   ADMIN_SECRET          long random string for the admin calls (setup() makes one if empty)
 *   BANK_ACCOUNT_HOLDER, BANK_ACCOUNT_NUMBER, BANK_ROUTING, BANK_ACCOUNT_TYPE, BANK_NAME   shown to customers
 *   OWNER_EMAIL           where sale emails go (default: the account that runs the script)
 *   BANK_ALERT_SENDERS    comma list of sender domains (default grey.co)
 *   BANK_CREDIT_WORDS     words marking an incoming-money alert (default received,credited,deposit,incoming,payment from)
 *   BANK_REQUIRE_DKIM     "0" only while testing (default on)
 *   BANK_ORDER_HOURS      how long an order stays open (default 48)
 *   PAYSTACK_SECRET_KEY   sk_test_... / sk_live_...: turns on "Pay by card" (Paystack)
 *   PAYSTACK_CURRENCY     NGN (default) or USD (only if Paystack enabled USD for your business)
 *   PAYSTACK_NGN_PER_USD  empty or "auto" (default): the live dollar-to-naira rate is fetched (cached for a few hours); a number fixes the rate instead
 *   PAYSTACK_NGN_FALLBACK naira per dollar to use only when the live rate cannot be fetched
 *   PAYSTACK_MARKUP_PCT   optional percent added to cover Paystack's fee and rate drift (default 0)
 *   SHEET_ID              the spreadsheet that holds the data (setup() creates it)
 */

var PRICES_USD = { solo: 49, team: 249, studio: 749, agency: 1999 };
var SEATS = { solo: 1, team: 5, studio: 20, agency: 100, enterprise: 999 };
var PLAN_TIERS = { solo: 'pro', team: 'pro', studio: 'studio', agency: 'studio', enterprise: 'studio', starter: 'free', basic: 'free', personal: 'pro' };
var TIERS = ['free', 'pro', 'studio'];
var TERMS = { month: [30, 1], year: [365, 10] };   // days, months paid (a year costs ten months)
var GRACE_DAYS = 3;
var TOKEN_DAYS = 366;
var REMIND_DAYS = 5;

// Sheet layout. Every cell is stored as text (so an id like 12e45 is never turned into a number); TYPES says how to read a column back.
var SCHEMA = {
  orders: ['id', 'tier', 'term', 'email', 'amount_cents', 'renew_pin', 'status', 'created_at', 'expires_at', 'pin', 'paid_at', 'paid_via', 'method', 'currency', 'expected_minor'],
  pins: ['pin', 'tier', 'seats', 'email', 'order_id', 'amount_cents', 'created_at', 'paid_until', 'revoked', 'machines', 'reminded_for'],
  seen: ['message_id', 'at'],
  unmatched: ['message_id', 'subject', 'amounts', 'at']
};
var TYPES = {
  amount_cents: 'n', expected_minor: 'n', seats: 'n', created_at: 'n', expires_at: 'n', paid_at: 'n', paid_until: 'n', reminded_for: 'n', at: 'n',
  revoked: 'b', machines: 'j', amounts: 'j'
};

// ── configuration ──
function prop_(k, d) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  return (v === null || v === undefined || v === '') ? (d === undefined ? '' : d) : v;
}
function nowSec_() { return Date.now() / 1000; }

// ── storage (a Google Sheet) ──
function book_() {
  var id = prop_('SHEET_ID');
  if (!id) throw new Error('Run setup() once: it creates the spreadsheet.');
  return SpreadsheetApp.openById(id);
}
function sheet_(name) {
  var ss = book_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var cols = SCHEMA[name];
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');   // plain text everywhere
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  }
  return sh;
}
function fromCell_(col, v) {
  var t = TYPES[col] || 's';
  if (t === 'n') return v === '' || v === null ? 0 : Number(v);
  if (t === 'b') return v === true || String(v).toLowerCase() === 'true';
  if (t === 'j') { try { return v === '' ? [] : JSON.parse(v); } catch (e) { return []; } }
  return v === null || v === undefined ? '' : String(v);
}
function toCell_(col, v) {
  var t = TYPES[col] || 's';
  if (t === 'j') return JSON.stringify(v === undefined ? [] : v);
  if (v === null || v === undefined) return '';
  return String(v);
}
function rows_(name) {
  var sh = sheet_(name), cols = SCHEMA[name], last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return vals.map(function (r, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = fromCell_(c, r[j]); });
    return o;
  });
}
function append_(name, obj) {
  var cols = SCHEMA[name];
  sheet_(name).appendRow(cols.map(function (c) { return toCell_(c, obj[c]); }));
}
function save_(name, obj) {
  var cols = SCHEMA[name];
  sheet_(name).getRange(obj._row, 1, 1, cols.length).setValues([cols.map(function (c) { return toCell_(c, obj[c]); })]);
}
function locked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}
