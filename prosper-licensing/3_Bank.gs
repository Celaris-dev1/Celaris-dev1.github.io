// ── bank alerts ──
var AMOUNT_RE_ = /(?:USD|US\$|\$)\s?([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)|([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})\s?(?:USD)\b/ig;
var NOT_THE_PAYMENT_ = /balance|fee|limit|available|charge/i;
function toCents_(s) { var n = Math.round(parseFloat(String(s).replace(/,/g, '')) * 100); return isNaN(n) ? null : n; }
function amountsIn_(text) {
  var out = [];
  String(text).split(/\r?\n/).forEach(function (line) {
    if (NOT_THE_PAYMENT_.test(line)) return;
    var m; AMOUNT_RE_.lastIndex = 0;
    while ((m = AMOUNT_RE_.exec(line)) !== null) {
      var c = toCents_(m[1] || m[2]);
      if (c !== null && out.indexOf(c) < 0) out.push(c);
    }
  });
  return out;
}
function allowedSenders_() {
  return prop_('BANK_ALERT_SENDERS', 'grey.co').split(',').map(function (s) { return s.trim().toLowerCase().replace(/^@/, ''); }).filter(Boolean);
}
function domainOk_(domain, allowed) {
  domain = String(domain).toLowerCase().replace(/^\.|\.$/g, '');
  return allowed.some(function (a) { return domain === a || domain.slice(-(a.length + 1)) === '.' + a; });
}
function headerBlock_(raw) {
  var i = raw.search(/\r?\n\r?\n/);
  return (i < 0 ? raw : raw.slice(0, i)).replace(/\r?\n[ \t]+/g, ' ');   // unfold continuation lines
}
function authenticated_(headers, allowed) {
  var m, re = /^Authentication-Results:\s*(.*)$/igm;
  while ((m = re.exec(headers)) !== null) {
    var h = m[1].toLowerCase(), x;
    var dk = /dkim=pass[^;]*?header\.(?:d|i)=@?([a-z0-9.\-]+)/g;
    while ((x = dk.exec(h)) !== null) if (domainOk_(x[1], allowed)) return true;
    var dm = /dmarc=pass[^;]*?header\.from=([a-z0-9.\-]+)/g;
    while ((x = dm.exec(h)) !== null) if (domainOk_(x[1], allowed)) return true;
  }
  return false;
}
/** raw = the whole message source; plain = its readable text. Returns what the alert says and whether it can be trusted. */
function parseAlert_(raw, plain, fallbackId) {
  var headers = headerBlock_(raw), allowed = allowedSenders_();
  var from = (/^From:\s*(.*)$/im.exec(headers) || [, ''])[1];
  var addr = ((/<([^>]+)>/.exec(from) || [, from])[1] || '').trim().toLowerCase();
  var subject = (/^Subject:\s*(.*)$/im.exec(headers) || [, ''])[1];
  var mid = ((/^Message-ID:\s*(.*)$/im.exec(headers) || [, ''])[1] || '').trim() || fallbackId;
  var text = subject + '\n' + plain;
  var words = prop_('BANK_CREDIT_WORDS', 'received,credited,deposit,incoming,payment from').split(',').map(function (w) { return w.trim().toLowerCase(); }).filter(Boolean);
  var lower = text.toLowerCase();
  var out = { message_id: mid, sender: addr, subject: subject, amounts: amountsIn_(text), credit: words.some(function (w) { return lower.indexOf(w) >= 0; }), trusted: false, reason: '' };
  if (!domainOk_(addr.split('@').pop(), allowed)) out.reason = 'sender ' + (addr || '?') + ' is not an allowed bank sender';
  else if (prop_('BANK_REQUIRE_DKIM', '1') !== '0' && !authenticated_(headers, allowed)) out.reason = "no dkim=pass / dmarc=pass recorded for the bank's domain (possible forgery)";
  else out.trusted = true;
  return out;
}

// ── mail ──
function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function mail_(to, subject, text, html) {
  try { MailApp.sendEmail(to, subject, text, { name: 'Prosper', htmlBody: html || undefined }); return true; }
  catch (e) { Logger.log('mail failed to ' + to + ': ' + e); return false; }
}
function notifyOwner_(subject, body) {
  var to = prop_('OWNER_EMAIL') || Session.getEffectiveUser().getEmail();
  mail_(to, subject, body);
}
function sendPin_(to, pin, tier, seats, days) {
  var text = 'Thank you for buying Prosper ' + tier + '.\n\nYour activation PIN: ' + pin + '\n\nOpen Prosper, go to Settings > Activate License and enter it. ' +
             'It works on ' + seats + ' machine(s) and is paid for ' + days + ' days. You will get a reminder before it ends.\n';
  var html = '<div style="font:15px/1.5 system-ui,sans-serif"><p>Thank you for buying <b>Prosper ' + esc_(tier) + '</b>.</p><p>Your activation PIN:</p>' +
             '<p style="font:600 22px/1 ui-monospace,monospace;letter-spacing:.06em">' + esc_(pin) + '</p><p>Open Prosper, go to <b>Settings &gt; Activate License</b> and enter it. ' +
             'It works on ' + seats + ' machine(s) and is paid for ' + days + ' days. You will get a reminder before it ends.</p></div>';
  return mail_(to, 'Your Prosper ' + tier.charAt(0).toUpperCase() + tier.slice(1) + ' License PIN', text, html);
}

// ── admin ──
function needAdmin_(b) {
  var secret = prop_('ADMIN_SECRET');
  if (!secret) throw httpErr_(503, 'ADMIN_SECRET is not set; admin calls are disabled.');
  var given = String(b.secret || ''), diff = given.length ^ secret.length;
  for (var i = 0; i < Math.min(given.length, secret.length); i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);   // constant-time-ish compare
  if (diff !== 0) throw httpErr_(401, 'Unauthorized');
}
