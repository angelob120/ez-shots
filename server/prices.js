// Fills the page's bound prices on the server, before the HTML leaves.
//
// js/prices.js does the same in the browser, but only once the config has
// been fetched, so a crawler, a link preview in a text message or a visitor
// without JavaScript read the number typed into the HTML instead. That number
// went stale the day the owner changed the price in admin. Doing it here means
// every reader gets the live price in the first byte, and js/prices.js is left
// as a harmless second pass.
//
// Only elements carrying data-price are touched, the same rule as the browser
// (see js/prices.js for why a find and replace on "$199" is wrong). Three shapes:
//   <meta data-price="..." content="...">   the content attribute
//   <b data-price="...">$99</b>             the element's whole text
//   <script type="application/ld+json" data-price="...">{...}</script>
//                                           the JSON, built by scripts/build-seo.mjs

const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");

// The same template language as js/prices.js. Null when a token names nothing,
// so the page keeps the text it shipped with rather than saying "undefined".
function fill(tpl, cfg) {
  let missing = false;
  const out = tpl.replace(/\{([a-z0-9+-]+)(\.first)?\}/gi, (whole, ids, first) => {
    let n = 0;
    for (const id of ids.split("+")) {
      const p = (cfg.packages || []).find((x) => x.id === id) || (cfg.addons || []).find((x) => x.id === id);
      const v = p ? (first && p.firstPrice !== undefined ? p.firstPrice : p.price) : undefined;
      if (v === undefined || v === null || v === "") missing = true;
      else n += Number(v);
    }
    return missing ? whole : "$" + n;
  });
  return missing ? null : out;
}

function render(html, cfg) {
  if (!cfg || !Array.isArray(cfg.packages) || !cfg.packages.length) return html;
  // Elements with a closing tag and no markup inside: the whole text is the template.
  html = html.replace(/<([a-z][a-z0-9]*)\b([^>]*?\sdata-price="([^"]*)"[^>]*)>([^<]*)<\/\1>/gi, (whole, tag, attrs, tpl, text) => {
    const out = fill(unesc(tpl), cfg);
    if (out === null) return whole;
    const body = tag.toLowerCase() === "script" ? out.replace(/</g, "\\u003c") : escText(out);
    return `<${tag}${attrs}>${body}</${tag}>`;
  });
  // Meta tags, which keep the text in an attribute.
  html = html.replace(/<meta\b[^>]*\sdata-price="([^"]*)"[^>]*>/gi, (whole, tpl) => {
    const out = fill(unesc(tpl), cfg);
    if (out === null) return whole;
    return whole.replace(/\scontent="[^"]*"/, ` content="${escAttr(out)}"`);
  });
  return html;
}

module.exports = { fill, render };
