// ── tiers, PINs, tokens ──
function normaliseTier_(t) {
  t = String(t || 'free').toLowerCase();
  t = PLAN_TIERS[t] || t;
  return TIERS.indexOf(t) >= 0 ? t : 'free';
}
function newPin_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', existing = {};
  rows_('pins').forEach(function (p) { existing[p.pin] = true; });
  for (var n = 0; n < 100; n++) {
    var raw = '';
    for (var i = 0; i < 12; i++) raw += chars.charAt(Math.floor(Math.random() * chars.length));
    var pin = raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8);
    if (!existing[pin]) return pin;
  }
  throw new Error('PIN space exhausted');
}
function jti_(pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pin);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 20);
}
function b64url_(bytesOrString) {
  var s = typeof bytesOrString === 'string' ? Utilities.base64EncodeWebSafe(bytesOrString, Utilities.Charset.UTF_8) : Utilities.base64EncodeWebSafe(bytesOrString);
  return s.replace(/=+$/, '');
}
function signRs256_(signingInput) {
  var key = prop_('LICENSE_PRIVATE_KEY');
  if (!key) throw new Error('LICENSE_PRIVATE_KEY is not set');
  return b64url_(Utilities.computeRsaSha256Signature(signingInput, key.replace(/\\n/g, '\n')));
}
function makeToken_(claims) {
  var head = b64url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var body = b64url_(JSON.stringify(claims));
  var input = head + '.' + body;
  return input + '.' + signRs256_(input);
}
// RSA PKCS#1 v1.5 signatures are deterministic, so "is this token one I signed?" = "does re-signing give the same signature?".
function readToken_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    if (signRs256_(parts[0] + '.' + parts[1]) !== parts[2]) return null;
    var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString();
    return JSON.parse(json);
  } catch (e) { return null; }
}
function termOver_(rec, t) { return !!rec.paid_until && t > rec.paid_until + GRACE_DAYS * 86400; }

// ── orders ──
function expireOrders_(t) {
  rows_('orders').forEach(function (o) {
    if (o.status === 'pending' && o.expires_at < t) { o.status = 'expired'; save_('orders', o); }
  });
}
function createOrder_(tier, email, term, renewPin, method) {
  method = method === 'paystack' ? 'paystack' : 'bank';
  tier = String(tier || '').toLowerCase(); term = String(term || 'month').toLowerCase();
  if (!PRICES_USD[tier]) throw httpErr_(400, 'Unknown plan "' + tier + '". Valid: ' + Object.keys(PRICES_USD).join(', '));
  if (!TERMS[term]) throw httpErr_(400, 'Unknown term "' + term + '". Valid: month, year');
  email = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpErr_(400, 'A valid email address is required: the PIN is sent there.');
  renewPin = String(renewPin || '').trim().toUpperCase();
  if (renewPin && !rows_('pins').filter(function (p) { return p.pin === renewPin; }).length) throw httpErr_(400, 'That PIN was not found, so it cannot be renewed.');
  return locked_(function () {
    var t = nowSec_();
    expireOrders_(t);
    var taken = {};
    rows_('orders').forEach(function (o) { if (o.status === 'pending' && o.method !== 'paystack') taken[o.amount_cents] = true; });
    var base = PRICES_USD[tier] * TERMS[term][1] * 100, free = [];
    var cur = 'USD', minor;
    if (method === 'paystack') {
      // a card payment is matched by its Paystack reference, so the price is exact (no identifying cents)
      cur = prop_('PAYSTACK_CURRENCY', 'NGN').toUpperCase();
      if (cur === 'NGN') {
        var rate = ngnPerUsd_();
        if (!(rate > 0)) throw httpErr_(503, 'Card payment is not available right now: the dollar rate could not be read. Try again shortly.');
        minor = Math.round(base * rate * (1 + Number(prop_('PAYSTACK_MARKUP_PCT', '0')) / 100));
      } else if (cur === 'USD') minor = base;
      else throw httpErr_(503, 'PAYSTACK_CURRENCY must be NGN or USD.');
      free = [base];
    } else {
      for (var c = 1; c < 100; c++) if (!taken[base + c]) free.push(base + c);
      minor = null;
    }
    if (!free.length) throw httpErr_(400, 'Too many open orders for this plan right now. Try again in a few hours.');
    var amount = free[Math.floor(Math.random() * free.length)];
    var o = { id: 'o' + Utilities.getUuid().replace(/-/g, '').slice(0, 15), tier: tier, term: term, email: email, amount_cents: amount,
              renew_pin: renewPin, status: 'pending', created_at: t, expires_at: t + Number(prop_('BANK_ORDER_HOURS', '48')) * 3600, pin: '', paid_at: 0, paid_via: '',
              method: method, currency: cur, expected_minor: minor === null ? amount : minor };
    append_('orders', o);
    return o;
  });
}
function orderById_(id) { return rows_('orders').filter(function (o) { return o.id === id; })[0] || null; }
function publicOrder_(o) {
  return { id: o.id, status: o.status, tier: o.tier, term: o.term, amount_usd: (o.amount_cents / 100).toFixed(2), expires_at: o.expires_at, method: o.method || 'bank' };
}
function account_() {
  return { account_holder: prop_('BANK_ACCOUNT_HOLDER'), account_number: prop_('BANK_ACCOUNT_NUMBER'), account_type: prop_('BANK_ACCOUNT_TYPE', 'Checking'),
           ach_routing: prop_('BANK_ROUTING'), bank_name: prop_('BANK_NAME'), currency: 'USD' };
}
