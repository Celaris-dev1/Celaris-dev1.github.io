/**
 * Prolu Grey autopay — runs inside the owner's Google account (script.google.com).
 *
 *  1. Buyers create an order on the website; this web app gives each order a unique
 *     amount (e.g. $20.37) and emails them the bank-transfer instructions.
 *  2. Every minute, checkGrey() reads new Grey "money received" emails, keeps only ones
 *     Gmail verified as DKIM-signed by grey.co, matches the amount to a pending order,
 *     then signs a license (same token format as Gate/Proof/…) and emails it.
 *  3. Anything it can't match is emailed to the owner instead.
 *
 * Secrets never live in this file: the signing key and bank instructions are kept in
 * Project Settings → Script Properties.
 */

var CONFIG = {
  GREY_DOMAIN: 'grey.co',
  ORDER_TTL_DAYS: 7,
  NACL_URL: 'https://cdnjs.cloudflare.com/ajax/libs/tweetnacl/1.0.3/nacl-fast.min.js',
  NACL_SHA256: '3ec535c004aeeb225785d8e93fb33bf99f52e399bd7dfc01969b5629baea5131',
  PLANS: {
    'gate-team-monthly':    { product: 'gate',  edition: 'team',    unit: 20,   perSeat: true,  days: 31,  grace: 14, features: ['sso'], label: 'Gate Team (1 month)' },
    'gate-team-yearly':     { product: 'gate',  edition: 'team',    unit: 200,  perSeat: true,  days: 366, grace: 14, features: ['sso'], label: 'Gate Team (1 year)' },
    'proof-starter-monthly':{ product: 'proof', edition: 'starter', unit: 99,   perSeat: false, days: 31,  grace: 14, features: [], label: 'Proof Starter (1 month)' },
    'proof-starter-yearly': { product: 'proof', edition: 'starter', unit: 990,  perSeat: false, days: 366, grace: 14, features: [], label: 'Proof Starter (1 year)' },
    'proof-pro-monthly':    { product: 'proof', edition: 'pro',     unit: 299,  perSeat: false, days: 31,  grace: 14, features: [], label: 'Proof Pro (1 month)' },
    'proof-pro-yearly':     { product: 'proof', edition: 'pro',     unit: 2990, perSeat: false, days: 366, grace: 14, features: [], label: 'Proof Pro (1 year)' }
  }
};

var HEADERS = ['order_id', 'created_at', 'status', 'plan', 'seats', 'name', 'email', 'amount', 'paid_at', 'license_id', 'grey_message_id'];

// ---------- one-time setup: run this from the editor ----------
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SIGNING_SEED')) {
    var seed = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + Date.now());
    props.setProperty('SIGNING_SEED', Utilities.base64Encode(seed));
  }
  if (!props.getProperty('SHEET_ID')) {
    props.setProperty('SHEET_ID', SpreadsheetApp.create('Prolu Orders').getId());
    sheet_().appendRow(HEADERS);
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkGrey') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkGrey').timeBased().everyMinutes(1).create();
  var pub = b64url_(keyPair_().publicKey);
  Logger.log('PUBLIC KEY (send this to Claude to embed in the products): ' + pub);
  Logger.log('Orders sheet: ' + SpreadsheetApp.openById(props.getProperty('SHEET_ID')).getUrl());
  if (!props.getProperty('BANK_INSTRUCTIONS')) Logger.log('Now add BANK_INSTRUCTIONS in Project Settings → Script Properties.');
}

// ---------- web app: create an order ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action !== 'order') return json_({ ok: true, service: 'prolu-autopay' });
    return json_(createOrder_(p));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function createOrder_(p) {
  var plan = CONFIG.PLANS[p.plan];
  if (!plan) throw new Error('Unknown plan');
  var email = String(p.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email');
  var name = String(p.name || '').trim().slice(0, 120);
  if (!name) throw new Error('Enter your name or company');
  var seats = plan.perSeat ? Math.max(1, Math.min(500, parseInt(p.seats, 10) || 1)) : 1;

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var rows = rows_();
    var pendingForEmail = rows.filter(function (r) { return r.status === 'pending' && r.email === email; });
    if (pendingForEmail.length >= 3) throw new Error('You already have pending orders — pay one or wait for them to expire');
    var base = plan.unit * seats;
    var used = {};
    rows.forEach(function (r) { if (r.status === 'pending') used[Number(r.amount).toFixed(2)] = true; });
    var cents = [];
    for (var c = 1; c <= 99; c++) if (!used[(base + c / 100).toFixed(2)]) cents.push(c);
    if (!cents.length) throw new Error('Too many open orders right now, try again later');
    var amount = (base + cents[Math.floor(Math.random() * cents.length)] / 100).toFixed(2);
    var id = 'PRL-' + Utilities.getUuid().slice(0, 8).toUpperCase();
    sheet_().appendRow([id, new Date().toISOString(), 'pending', p.plan, seats, name, email, amount, '', '', '']);
  } finally {
    lock.releaseLock();
  }

  var bank = PropertiesService.getScriptProperties().getProperty('BANK_INSTRUCTIONS') || '(bank details coming — reply to this email)';
  var body = 'Hi ' + name + ',\n\nThanks for ordering ' + plan.label + (plan.perSeat ? ' × ' + seats + ' seats' : '') + '.\n\n' +
    'Please send EXACTLY $' + amount + ' (USD) by bank transfer to:\n\n' + bank + '\n\n' +
    'Put ' + id + ' in the memo if your bank allows it.\n' +
    'The exact cents identify your order: your license key is emailed to you automatically within minutes of the money arriving.\n' +
    'This order expires in ' + CONFIG.ORDER_TTL_DAYS + ' days.\n\n— Prolu';
  GmailApp.sendEmail(email, 'Prolu order ' + id + ' — pay $' + amount, body, { name: 'Prolu' });
  return { ok: true, order_id: id, amount: amount, instructions: bank };
}

// ---------- every minute: read Grey emails ----------
function checkGrey() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    expireOld_();
    var done = GmailApp.getUserLabelByName('prolu-done') || GmailApp.createLabel('prolu-done');
    var threads = GmailApp.search('from:' + CONFIG.GREY_DOMAIN + ' newer_than:14d -label:prolu-done', 0, 30);
    threads.forEach(function (th) {
      th.getMessages().forEach(function (m) { handleMessage_(m); });
      th.addLabel(done);
    });
  } finally {
    lock.releaseLock();
  }
}

function handleMessage_(m) {
  var raw = m.getRawContent();
  if (!greyVerified_(raw)) return; // spoofed / unverified: ignore silently
  var text = (m.getPlainBody() || '') + '\n' + m.getSubject();
  if (!/(received|credited|incoming|deposit)/i.test(text)) return; // not an incoming-payment alert
  var amount = parseAmount_(text);
  if (!amount) return notifyOwner_('Grey alert I could not read', m);

  var sh = sheet_(), rows = rows_();
  if (rows.some(function (r) { return r.grey_message_id === m.getId(); })) return; // already handled
  var match = rows.filter(function (r) { return r.status === 'pending' && Number(r.amount).toFixed(2) === amount; });
  if (match.length !== 1) return notifyOwner_('Payment of $' + amount + ' matched ' + match.length + ' orders', m);

  var o = match[0], plan = CONFIG.PLANS[o.plan];
  var now = new Date();
  var exp = new Date(now.getTime() + (plan.days + plan.grace) * 86400000);
  var lic = {
    license_id: 'lic_' + Utilities.getUuid().replace(/-/g, '').slice(0, 20),
    customer: o.name + ' <' + o.email + '>',
    product: plan.product,
    edition: plan.edition
  };
  if (plan.features.length) lic.features = plan.features;
  lic.seats = Number(o.seats);
  lic.issued_at = rfc3339_(now);
  lic.expires_at = rfc3339_(exp);
  var token = signLicense_(lic);

  var r = o._row;
  sh.getRange(r, 3).setValue('paid');
  sh.getRange(r, 9).setValue(now.toISOString());
  sh.getRange(r, 10).setValue(lic.license_id);
  sh.getRange(r, 11).setValue(m.getId());

  GmailApp.sendEmail(o.email, 'Your Prolu license — ' + plan.label,
    'Payment of $' + amount + ' received for order ' + o.order_id + '. Thank you!\n\n' +
    'Your license key (valid until ' + exp.toISOString().slice(0, 10) + '):\n\n' + token + '\n\n' +
    'Activate it:\n  ' + plan.product + ' license install <paste key>\n\n' +
    'Questions: just reply to this email.\n\n— Prolu', { name: 'Prolu' });
  GmailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Sale: $' + amount + ' ' + o.order_id,
    o.name + ' <' + o.email + '> — ' + plan.label + ' × ' + o.seats + '. License ' + lic.license_id + ' sent.');
}

// Gmail stamps its own Authentication-Results header at the top of every received
// message; a sender can't forge that topmost one. Require dkim=pass for grey.co.
function greyVerified_(raw) {
  var head = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
  var ar = head.split(/\r?\n/).filter(function (l) { return /^Authentication-Results:\s*mx\.google\.com/i.test(l); })[0];
  if (!ar) return false;
  var re = /dkim=pass[^;]*header\.(?:i|d)=@?([a-z0-9.-]+)/ig, mm;
  while ((mm = re.exec(ar))) {
    var d = mm[1].toLowerCase();
    if (d === CONFIG.GREY_DOMAIN || d.slice(-(CONFIG.GREY_DOMAIN.length + 1)) === '.' + CONFIG.GREY_DOMAIN) return true;
  }
  return false;
}

function parseAmount_(text) {
  var m = text.match(/(?:\$|USD\s?)\s?([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\.([0-9]{2})\b/);
  return m ? (m[1].replace(/,/g, '') + '.' + m[2]) : null;
}

function notifyOwner_(subject, m) {
  GmailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Prolu autopay: ' + subject,
    'Check this Grey email and the Prolu Orders sheet by hand:\n\n' + m.getSubject() + '\n' + m.getDate());
}

function expireOld_() {
  var sh = sheet_(), cutoff = Date.now() - CONFIG.ORDER_TTL_DAYS * 86400000;
  rows_().forEach(function (r) {
    if (r.status === 'pending' && new Date(r.created_at).getTime() < cutoff) sh.getRange(r._row, 3).setValue('expired');
  });
}

// ---------- license signing (Ed25519, same token format as the products) ----------
function signLicense_(lic) {
  var payload = Utilities.newBlob(JSON.stringify(lic)).getBytes();
  var msg = new Uint8Array(payload.map(function (b) { return b & 255; }));
  var sig = nacl_().sign.detached(msg, keyPair_().secretKey);
  return b64url_(msg) + '.' + b64url_(sig);
}

function keyPair_() {
  var seed = PropertiesService.getScriptProperties().getProperty('SIGNING_SEED');
  if (!seed) throw new Error('Run setup() first');
  var bytes = Utilities.base64Decode(seed).map(function (b) { return b & 255; });
  return nacl_().sign.keyPair.fromSeed(new Uint8Array(bytes));
}

var NACL_;
function nacl_() {
  if (NACL_) return NACL_;
  var cache = CacheService.getScriptCache();
  var code = cache.get('nacl') || UrlFetchApp.fetch(CONFIG.NACL_URL).getContentText();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, code, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  if (digest !== CONFIG.NACL_SHA256) throw new Error('tweetnacl integrity check failed');
  cache.put('nacl', code, 21600);
  NACL_ = new Function('var self = {};\n' + code + '\nreturn self.nacl;')();
  return NACL_;
}

// ---------- helpers ----------
function b64url_(u8) {
  return Utilities.base64EncodeWebSafe(Array.prototype.slice.call(u8).map(function (b) { return b > 127 ? b - 256 : b; })).replace(/=+$/, '');
}
function rfc3339_(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }
function sheet_() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getSheets()[0]; }
function rows_() {
  var v = sheet_().getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var o = { _row: i + 1 };
    HEADERS.forEach(function (h, j) { o[h] = v[i][j]; });
    o.amount = Number(o.amount).toFixed(2);
    out.push(o);
  }
  return out;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
