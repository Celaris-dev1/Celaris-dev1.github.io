// ── the buy page ──
function buyPage_() {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Buy Prosper</title>' +
  '<style>' +
  ':root{--bg:#0f1115;--card:#171a21;--fg:#e9e7e2;--mute:#9aa0aa;--line:#2a2f3a;--acc:#7cc4a4;--warn:#e8b45c}' +
  '@media (prefers-color-scheme:light){:root{--bg:#f6f5f1;--card:#fff;--fg:#1b1d22;--mute:#5d6470;--line:#dcd9d0;--acc:#1f7a57;--warn:#9a6a10}}' +
  '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:20px 16px}' +
  'main{max-width:520px;margin:0 auto;display:grid;gap:16px}h1{font-size:1.5rem;margin:0}p{margin:0;color:var(--mute)}' +
  '.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;display:grid;gap:12px}' +
  'label{display:grid;gap:4px;font-size:.85rem;color:var(--mute)}select,input,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}' +
  'button{background:var(--acc);color:#0b1210;border:0;font-weight:600;cursor:pointer}button:disabled{opacity:.5}' +
  '.row{display:flex;justify-content:space-between;gap:12px;align-items:baseline;border-bottom:1px solid var(--line);padding:6px 0}.row:last-child{border:0}' +
  '.row b{font-variant-numeric:tabular-nums;word-break:break-all;text-align:right}.amt{font-size:2rem;font-weight:700;font-variant-numeric:tabular-nums}' +
  '.st{padding:10px 12px;border-radius:8px;border:1px solid var(--line)}.ok{color:var(--acc)}.wait{color:var(--warn)}[hidden]{display:none!important}' +
  '</style></head><body><main>' +
  '<header><h1>Buy Prosper</h1><p>Pay by bank transfer (USD). Your activation PIN is emailed as soon as the money arrives.</p></header>' +
  '<form id="f" class="card"><label>Plan<select id="tier"></select></label><label>Term<select id="term"><option value="month">1 month</option><option value="year">1 year (2 months free)</option></select></label>' +
  '<label>Email for your PIN<input id="email" type="email" autocomplete="email" required></label>' +
  '<label id="mwrap" hidden>How do you want to pay?<select id="method"><option value="card">Card (Paystack)</option><option value="bank">Bank transfer (USD)</option></select></label>' +
  '<label>Renewing? Existing PIN (optional)<input id="renew" autocapitalize="characters" placeholder="XXXX-XXXX-XXXX"></label><button id="go" type="submit">Continue</button>' +
  '<p id="rate" hidden></p>' +
  '<p id="err" class="wait" hidden></p></form>' +
  '<section id="pay" class="card" hidden><p>Send exactly</p><div class="amt" id="amt"></div><p>The cents identify your payment. Do not round.</p><div id="acct"></div>' +
  '<div class="st wait" id="st">Waiting for your payment. This page updates by itself.</div></section>' +
  '</main><script>' +
  'var $=function(i){return document.getElementById(i)},run=google.script.run;' +
  'function fail(m){$("err").textContent=m;$("err").hidden=false;$("go").disabled=false}' +
  'run.withSuccessHandler(function(i){var s=$("tier");Object.keys(i.plans).forEach(function(t){var o=document.createElement("option");o.value=t;' +
  'o.textContent=t.charAt(0).toUpperCase()+t.slice(1)+" - $"+i.plans[t].month_usd+"/month";s.appendChild(o)});if(i.card){$("mwrap").hidden=false;if(i.card_currency==="NGN"&&i.ngn_per_usd){$("rate").hidden=false;$("rate").textContent="Prices are in dollars. Your card is charged the naira equivalent at the current rate (about N"+Math.round(i.ngn_per_usd)+" per $1); your bank converts it to your currency."}}if(!i.configured&&!i.card)fail("Payments are not set up yet.");if(!i.configured&&i.card){$("method").value="card";$("method").querySelector("option[value=bank]").remove()}}).withFailureHandler(function(e){fail(e.message)}).apiInfo();' +
  '$("f").onsubmit=function(ev){ev.preventDefault();$("go").disabled=true;$("err").hidden=true;' +
  'var card=!$("mwrap").hidden&&$("method").value==="card";if(card){run.withSuccessHandler(function(o){window.top.location.href=o.authorization_url}).withFailureHandler(function(e){fail(e.message)}).apiPaystack($("tier").value,$("email").value,$("term").value,$("renew").value);return}' +
  'run.withSuccessHandler(show).withFailureHandler(function(e){fail(e.message)}).apiOrder($("tier").value,$("email").value,$("term").value,$("renew").value)};' +
  'function show(o){$("f").hidden=true;$("pay").hidden=false;$("amt").textContent="$"+o.amount_usd+" USD";var a=o.pay_to,rows=[["Account holder",a.account_holder],["Account number",a.account_number],' +
  '["Account type",a.account_type],["ACH routing",a.ach_routing],["Bank",a.bank_name]];$("acct").innerHTML=rows.map(function(r){return \'<div class="row"><span>\'+r[0]+\'</span><b>\'+' +
  'String(r[1]).replace(/[&<>]/g,"")+"</b></div>"}).join("");var t=setInterval(function(){run.withSuccessHandler(function(s){' +
  'if(s.status==="paid"){clearInterval(t);$("st").className="st ok";$("st").textContent="Payment received. Check your email for your PIN (and spam)."}' +
  'else if(s.status==="expired"){clearInterval(t);$("st").textContent="This order expired. Start a new one."}}).apiStatus(o.id)},15000)}' +
  '</script></body></html>';
}
