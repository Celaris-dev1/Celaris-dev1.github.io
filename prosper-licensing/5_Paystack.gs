// ── Paystack (card payments; the payment is confirmed with Paystack's API, never trusted from the browser) ──
function paystackFetch_(path, payload) {
  var key = prop_('PAYSTACK_SECRET_KEY');
  if (!key) throw httpErr_(503, 'Card payment is not set up yet.');
  var opts = { method: payload ? 'post' : 'get', headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true };
  if (payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(payload); }
  var r = UrlFetchApp.fetch('https://api.paystack.co' + path, opts), body;
  try { body = JSON.parse(r.getContentText()); } catch (e) { body = {}; }
  return { code: r.getResponseCode(), body: body };
}
/** Naira per dollar. A number in PAYSTACK_NGN_PER_USD fixes it; otherwise the live rate (open.er-api.com, free, no key) cached for 3 hours, else PAYSTACK_NGN_FALLBACK. */
function ngnPerUsd_() {
  var fixed = Number(prop_('PAYSTACK_NGN_PER_USD'));
  if (fixed > 0) return fixed;
  var cache = CacheService.getScriptCache(), hit = Number(cache.get('ngn_rate'));
  if (hit > 0) return hit;
  try {
    var r = UrlFetchApp.fetch('https://open.er-api.com/v6/latest/USD', { muteHttpExceptions: true });
    var rate = Number((JSON.parse(r.getContentText()).rates || {}).NGN);
    if (r.getResponseCode() === 200 && rate > 100 && rate < 100000) {   // a sanity band: a broken feed must never price a plan at 1 naira
      cache.put('ngn_rate', String(rate), 10800);
      return rate;
    }
  } catch (e) { Logger.log('rate fetch failed: ' + e); }
  return Number(prop_('PAYSTACK_NGN_FALLBACK')) || 0;
}
function startPaystack_(o) {
  var res = paystackFetch_('/transaction/initialize', { email: o.email, amount: o.expected_minor, currency: o.currency, reference: o.id,
    callback_url: ScriptApp.getService().getUrl(), metadata: { order_id: o.id, tier: o.tier, term: o.term } });
  if (!res.body.status || !res.body.data) throw httpErr_(502, 'Paystack: ' + (res.body.message || 'could not start the payment'));
  return res.body.data.authorization_url;
}
/** Ask Paystack whether this reference was paid, and pay the order only if amount, currency and reference all match. */
function verifyPaystack_(ref) {
  var o = orderById_(String(ref || ''));
  if (!o || o.method !== 'paystack') return { status: 'unknown' };
  if (o.status === 'paid') return { status: 'paid', order: o };
  if (o.status !== 'pending') return { status: o.status, order: o };
  var res = paystackFetch_('/transaction/verify/' + encodeURIComponent(o.id));
  var d = res.body && res.body.data;
  if (!res.body.status || !d || d.status !== 'success') return { status: 'pending', order: o };
  if (d.reference !== o.id || String(d.currency).toUpperCase() !== o.currency || Number(d.amount) < o.expected_minor) {
    Logger.log('paystack payment does not match order ' + o.id + ': ' + JSON.stringify({ ref: d.reference, cur: d.currency, amount: d.amount }));
    notifyOwner_('Prosper: a Paystack payment does not match its order', 'Order ' + o.id + ' expected ' + o.expected_minor + ' ' + o.currency + ' but Paystack reports ' + d.amount + ' ' + d.currency + '. Check it in the Paystack dashboard; approve by hand if it is fine.');
    return { status: 'mismatch', order: o };
  }
  return locked_(function () {
    var fresh = orderById_(o.id);
    if (fresh.status === 'paid') return { status: 'paid', order: fresh };
    return { status: 'paid', order: fulfil_(fresh, 'paystack:' + (d.id || o.id)) };
  });
}
function checkPaystackPending_() {
  if (!prop_('PAYSTACK_SECRET_KEY')) return 0;
  var t = nowSec_(), n = 0;
  rows_('orders').filter(function (o) { return o.method === 'paystack' && o.status === 'pending' && o.expires_at > t; }).slice(-20).forEach(function (o) {
    try { if (verifyPaystack_(o.id).status === 'paid') n++; } catch (e) { Logger.log('paystack check failed: ' + e); }
  });
  return n;
}
function paystackReturnPage_(ref) {
  var r; try { r = verifyPaystack_(ref); } catch (e) { r = { status: 'error' }; }
  var msg = { paid: 'Payment received. Your PIN is on its way to your email (check spam too).', pending: 'Waiting for Paystack to confirm your payment. This page refreshes by itself.',
              mismatch: 'We could not match this payment to your order. Contact support with your reference.', unknown: 'Order not found.', error: 'Could not check the payment. Refresh in a moment.', expired: 'This order expired.' }[r.status] || 'Order status: ' + r.status;
  return '<!doctype html><html><head><meta charset="utf-8"><title>Prosper payment</title>' + (r.status === 'pending' ? '<meta http-equiv="refresh" content="8">' : '') +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:17px/1.5 system-ui,sans-serif;background:#0f1115;color:#ebe9e4;padding:24px 16px}main{max-width:480px;margin:10vh auto}h1{font-size:1.4rem}</style></head><body><main><h1>' +
    (r.status === 'paid' ? 'Thank you' : 'Prosper payment') + '</h1><p>' + esc_(msg) + '</p><p style="color:#9aa0aa;font-size:.9rem">Reference: ' + esc_(ref) + '</p></main></body></html>';
}

// ── one-time setup (run from the editor) ──
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_ID')) props.setProperty('SHEET_ID', SpreadsheetApp.create('Prosper licences').getId());
  if (!props.getProperty('ADMIN_SECRET')) {
    var s = ''; for (var i = 0; i < 4; i++) s += Utilities.getUuid().replace(/-/g, '');
    props.setProperty('ADMIN_SECRET', s);
  }
  Object.keys(SCHEMA).forEach(sheet_);
  var url = ScriptApp.getService().getUrl();
  Logger.log('Setup done. Spreadsheet: ' + SpreadsheetApp.openById(props.getProperty('SHEET_ID')).getUrl());
  Logger.log('Web app URL (after you deploy): ' + url);
  Logger.log('ADMIN_SECRET is stored in Script properties (Project Settings). Not printed here.');
}
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'pollInbox') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pollInbox').timeBased().everyMinutes(1).create();
  Logger.log('Inbox check will run every minute.');
}
