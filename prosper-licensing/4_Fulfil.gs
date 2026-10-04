// ── fulfilment ──
function fulfil_(o, via) {
  var days = TERMS[o.term][0], t = nowSec_(), pin, isNew;
  if (o.renew_pin) {
    var rec = rows_('pins').filter(function (p) { return p.pin === o.renew_pin; })[0];
    pin = o.renew_pin; isNew = false;
    rec.paid_until = Math.max(t, rec.paid_until || 0) + days * 86400;
    rec.tier = o.tier; rec.seats = SEATS[o.tier] || 1; rec.reminded_for = 0;
    save_('pins', rec);
  } else {
    pin = newPin_(); isNew = true;
    append_('pins', { pin: pin, tier: o.tier, seats: SEATS[o.tier] || 1, email: o.email, order_id: o.id, amount_cents: o.amount_cents, created_at: t,
                      paid_until: t + days * 86400, revoked: false, machines: [], reminded_for: 0 });
  }
  o.status = 'paid'; o.pin = pin; o.paid_at = t; o.paid_via = via;
  save_('orders', o);
  if (isNew) sendPin_(o.email, pin, o.tier, SEATS[o.tier] || 1, days);
  else mail_(o.email, 'Your Prosper licence is renewed', 'Thank you. Your licence ' + pin + ' is paid for another ' + days + ' days.');
  notifyOwner_('Prosper sale: ' + o.tier + ' ' + o.term + ' $' + (o.amount_cents / 100).toFixed(2),
    'A ' + (isNew ? 'new customer' : 'renewal') + ' paid by bank transfer (' + via + ').\n\nCustomer: ' + o.email + '\nPlan: ' + o.tier + ' (' + o.term + ')\nAmount: $' +
    (o.amount_cents / 100).toFixed(2) + '\nPIN: ' + pin + '\nOrder: ' + o.id);
  return o;
}
/** One parsed alert -> {status: paid|duplicate|ignored|unmatched}. Safe to call twice with the same alert. */
function processAlert_(a) {
  var result = locked_(function () {
    var t = nowSec_();
    if (rows_('seen').some(function (s) { return s.message_id === a.message_id; })) return { status: 'duplicate' };
    append_('seen', { message_id: a.message_id, at: t });
    if (!a.trusted) { Logger.log('bank alert ignored: ' + a.reason + ' (' + a.subject + ')'); return { status: 'ignored', reason: a.reason }; }
    if (!a.credit || !a.amounts.length) return { status: 'ignored', reason: 'not an incoming-money alert' };
    expireOrders_(t);
    var pending = {};
    rows_('orders').forEach(function (o) { if (o.status === 'pending' && o.method !== 'paystack') pending[o.amount_cents] = o; });
    var hits = a.amounts.filter(function (x) { return pending[x]; });
    if (hits.length === 1) { var o = fulfil_(pending[hits[0]], 'email:' + a.message_id); return { status: 'paid', order: o.id, pin: o.pin }; }
    append_('unmatched', { message_id: a.message_id, subject: a.subject, amounts: a.amounts, at: t });
    return { status: 'unmatched' };
  });
  if (result.status === 'unmatched') {
    notifyOwner_('Prosper: bank deposit that matches no order',
      'Amounts seen: ' + a.amounts.map(function (x) { return '$' + (x / 100).toFixed(2); }).join(', ') + '\nSubject: ' + a.subject +
      '\n\nNobody opened an order for this amount, the order expired, or fees changed the amount in transit.\nIf it is a real sale, approve it from the admin page (the "orders" sheet lists open orders).');
  }
  return result;
}
/** The time trigger: one pass over the inbox. Gmail's own search keeps this cheap (only the bank's recent mail). */
function pollInbox() {
  var out = [], senders = allowedSenders_();
  senders.forEach(function (s) {
    GmailApp.search('from:' + s + ' newer_than:3d', 0, 50).forEach(function (th) {
      th.getMessages().forEach(function (m) {
        try { out.push(processAlert_(parseAlert_(m.getRawContent(), m.getPlainBody(), m.getId()))); }
        catch (e) { Logger.log('alert failed: ' + e); }
      });
    });
  });
  try { checkPaystackPending_(); } catch (e) { Logger.log('paystack check failed: ' + e); }
  try { sendRenewalReminders_(); } catch (e) { Logger.log('reminders failed: ' + e); }
  return out;
}
function sendRenewalReminders_() {
  var t = nowSec_(), sent = 0;
  rows_('pins').forEach(function (p) {
    if (p.revoked || !p.paid_until || p.paid_until < t || p.paid_until - t > REMIND_DAYS * 86400 || p.reminded_for === p.paid_until) return;
    var url = ScriptApp.getService().getUrl();
    if (mail_(p.email, 'Your Prosper licence ends soon',
      'Your Prosper licence ' + p.pin + ' is paid until ' + new Date(p.paid_until * 1000).toDateString() + '.\n\nTo renew, open ' + url + ' and choose "Renew", then enter your PIN.\n')) {
      p.reminded_for = p.paid_until; save_('pins', p); sent++;
    }
  });
  return sent;
}
function confirmOrder_(id) {
  return locked_(function () {
    var o = orderById_(id);
    if (!o) throw httpErr_(404, 'Order not found');
    if (o.status === 'paid') return o;
    return fulfil_(o, 'owner');
  });
}

// ── activation service (what a Prosper install calls) ──
function activate_(b) {
  var pin = String(b.pin || '').trim().toUpperCase(), machine = String(b.machine_id || '').trim();
  if (!pin || !machine) throw httpErr_(400, 'pin and machine_id are required');
  return locked_(function () {
    var rec = rows_('pins').filter(function (p) { return p.pin === pin; })[0];
    if (!rec) throw httpErr_(404, 'PIN not found');
    if (rec.revoked) throw httpErr_(403, 'This PIN was revoked. Contact support.');
    var t = nowSec_();
    if (termOver_(rec, t)) throw httpErr_(403, "This licence's paid term has ended. Renew it, then try again.");
    var machines = rec.machines || [];
    if (machines.indexOf(machine) < 0) {
      if (machines.length >= (rec.seats || 1)) throw httpErr_(403, 'All ' + (rec.seats || 1) + ' seat(s) of this licence are in use. Deactivate one machine first.');
      machines.push(machine); rec.machines = machines; save_('pins', rec);
    }
    var iat = Math.floor(t);
    var claims = { customer: b.customer_name || rec.email, tier: normaliseTier_(rec.tier), plan: rec.tier, seats: rec.seats || 1, machine_id: machine, jti: jti_(pin), iat: iat, exp: iat + TOKEN_DAYS * 86400 };
    return { token: makeToken_(claims), tier: claims.tier, plan: claims.plan, customer: claims.customer, expires: claims.exp };
  });
}
function verify_(b) {
  var claims = readToken_(b.token);
  if (!claims) return { valid: false, revoked: false, reason: 'token invalid' };
  if (claims.exp && claims.exp < nowSec_()) return { valid: false, revoked: false, reason: 'token expired' };
  var rec = rows_('pins').filter(function (p) { return jti_(p.pin) === claims.jti; })[0];
  if (!rec) return { valid: false, revoked: false, reason: 'unknown licence' };
  if (rec.revoked) return { valid: false, revoked: true, reason: 'revoked' };
  if (termOver_(rec, nowSec_())) return { valid: false, revoked: false, reason: 'paid term ended' };
  if (claims.machine_id && (rec.machines || []).indexOf(claims.machine_id) < 0) return { valid: false, revoked: false, reason: 'this machine was deactivated' };
  return { valid: true, revoked: false, reason: '' };
}
function deactivate_(b) {
  return locked_(function () {
    var pin = String(b.pin || '').trim().toUpperCase(), machine = String(b.machine_id || '').trim();
    var rec = rows_('pins').filter(function (p) { return p.pin === pin; })[0];
    if (!rec) return { freed: false };
    rec.machines = (rec.machines || []).filter(function (m) { return m !== machine; });
    save_('pins', rec);
    return { freed: true };
  });
}
