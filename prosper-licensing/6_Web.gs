// ── web app ──
function httpErr_(status, detail) { var e = new Error(detail); e.http = status; e.detail = detail; return e; }
function json_(status, data) {
  var body = {}; for (var k in data) body[k] = data[k];
  body.http_status = status;                       // a Web App always answers 200: the real status travels in the body (core/activation_client.py reads it)
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
function route_(action, b) {
  switch (action) {
    case 'health': return { ok: true, signing: !!prop_('LICENSE_PRIVATE_KEY') };
    case 'activate': return activate_(b);
    case 'verify': return verify_(b);
    case 'deactivate': return deactivate_(b);
    case 'bank_info': {
      var acct = account_(), plans = {};
      Object.keys(PRICES_USD).forEach(function (t) { plans[t] = { month_usd: PRICES_USD[t], year_usd: PRICES_USD[t] * TERMS.year[1] }; });
      return { configured: !!(acct.account_number && acct.ach_routing), account: acct, plans: plans, card: !!prop_('PAYSTACK_SECRET_KEY'), card_currency: prop_('PAYSTACK_CURRENCY', 'NGN').toUpperCase(),
               ngn_per_usd: prop_('PAYSTACK_SECRET_KEY') && prop_('PAYSTACK_CURRENCY', 'NGN').toUpperCase() === 'NGN' ? (ngnPerUsd_() || null) : null };
    }
    case 'bank_order': {
      if (!account_().account_number) throw httpErr_(503, 'Bank transfer is not set up yet.');
      var o = createOrder_(b.tier, b.email, b.term, b.renew_pin);
      return Object.assign(publicOrder_(o), { pay_to: account_(), note: 'Send exactly $' + (o.amount_cents / 100).toFixed(2) + ' USD. Do not round the amount.' });
    }
    case 'paystack_order': {
      var po = createOrder_(b.tier, b.email, b.term, b.renew_pin, 'paystack');
      return Object.assign(publicOrder_(po), { currency: po.currency, amount_minor: po.expected_minor, authorization_url: startPaystack_(po) });
    }
    case 'bank_status': {
      var s = orderById_(String(b.id || ''));
      if (!s) throw httpErr_(404, 'Order not found');
      if (s.status === 'pending' && s.method === 'paystack') verifyPaystack_(s.id);
      else if (s.status === 'pending') pollSoon_();     // the customer is waiting: look at the inbox now instead of at the next trigger
      return publicOrder_(orderById_(s.id));
    }
    case 'admin_orders': needAdmin_(b); return { orders: rows_('orders'), unmatched: rows_('unmatched') };
    case 'admin_confirm': needAdmin_(b); return publicOrder_(confirmOrder_(String(b.id || '')));
    case 'admin_revoke': needAdmin_(b); return locked_(function () {
      var rec = rows_('pins').filter(function (p) { return p.pin === String(b.pin || '').toUpperCase(); })[0];
      if (!rec) throw httpErr_(404, 'PIN not found');
      rec.revoked = true; save_('pins', rec); return { revoked: rec.pin };
    });
    case 'admin_poll': needAdmin_(b); return { results: pollInbox() };
    default: throw httpErr_(404, 'Unknown action "' + action + '"');
  }
}
function pollSoon_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('polled')) return;
  cache.put('polled', '1', 20);                    // at most once every 20 seconds, however many customers are waiting
  try { pollInbox(); } catch (e) { Logger.log('poll failed: ' + e); }
}
function handle_(e, method) {
  var body = {};
  try { if (method === 'POST' && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents); } catch (x) { return json_(400, { detail: 'Body is not JSON' }); }
  var p = e.parameter || {};
  for (var k in p) if (body[k] === undefined) body[k] = p[k];
  var action = body.action || (e.pathInfo ? String(e.pathInfo).replace(/^\/+/, '') : '');
  try { return json_(200, route_(action, body)); }
  catch (err) {
    if (err && err.http) return json_(err.http, { detail: err.detail });
    Logger.log('error in ' + action + ': ' + (err && err.stack || err));
    return json_(500, { detail: 'Server error' });
  }
}
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) return handle_(e, 'GET');
  if (p.reference || p.trxref) return HtmlService.createHtmlOutput(paystackReturnPage_(p.reference || p.trxref)).setTitle('Prosper payment').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return HtmlService.createHtmlOutput(buyPage_()).setTitle('Buy Prosper').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function doPost(e) { return handle_(e, 'POST'); }

// google.script.run entry points for the buy page (they return plain objects)
function apiInfo() { return route_('bank_info', {}); }
function apiOrder(tier, email, term, renewPin) { return route_('bank_order', { tier: tier, email: email, term: term, renew_pin: renewPin }); }
function apiPaystack(tier, email, term, renewPin) { return route_('paystack_order', { tier: tier, email: email, term: term, renew_pin: renewPin }); }
function apiStatus(id) { return route_('bank_status', { id: id }); }
