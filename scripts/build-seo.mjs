// Builds everything search engines read, from files in the repo. No network.
//
//   npm run seo
//
// 1. The blog: blog.html (the index) and blog/<slug>.html (one per article)
//    from scripts/blog-posts.json, which scripts/write-blog.mjs writes. Static
//    pages on purpose: a crawler gets the whole article without running JS.
// 2. The head of every public page: canonical, Open Graph, Twitter card and
//    JSON-LD, between <!-- seo --> markers so a rerun replaces, never stacks.
// 3. sitemap.xml and robots.txt.
//
// Rerun it after editing a post, adding a page or changing a page's title or
// description. It is idempotent: run it twice and git sees no change.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://ezshots.org";
const OG_IMAGE = "/img/work/brick-colonial-exterior-front-hero.webp";
const EMAIL = "angelobrown1000@gmail.com";
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const write = (f, s) => { fs.mkdirSync(path.dirname(path.join(ROOT, f)), { recursive: true }); fs.writeFileSync(path.join(ROOT, f), s); };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, "-");
const strip = (s) => unesc(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
// Inside a <script type="application/ld+json">, "</" must not appear.
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;

// Public pages: file, clean path, breadcrumb name. Order is the sitemap order.
const PAGES = [
  ["index.html", "/", null],
  ["services.html", "/services", "Services"],
  ["portfolio.html", "/portfolio", "Portfolio"],
  ["packages.html", "/packages", "Pricing"],
  ["guarantee.html", "/guarantee", "The guarantee"],
  ["about.html", "/about", "About"],
  ["contact.html", "/contact", "Contact"],
  ["areas.html", "/areas", "Areas we serve"],
  ["faq.html", "/faq", "FAQ"],
  ["book.html", "/book", "Book a shoot"],
  ["blog.html", "/blog", "Blog"],
  ["refund.html", "/refund", "Refunds"],
  ["terms.html", "/terms", "Terms"],
  ["privacy.html", "/privacy", "Privacy"],
];

const AREAS = ["Wayne County, MI", "Oakland County, MI", "Macomb County, MI", "Detroit, MI", "Birmingham, MI",
  "Royal Oak, MI", "Ferndale, MI", "Troy, MI", "Rochester Hills, MI", "Grosse Pointe, MI", "Northville, MI", "Dearborn, MI"];

const BUSINESS = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  "@id": `${SITE}/#business`,
  name: "EZ Shots",
  description: "Real estate photography, one minute listing video and FAA Part 107 drone aerials for realtors across Metro Detroit.",
  url: `${SITE}/`,
  image: `${SITE}${OG_IMAGE}`,
  logo: `${SITE}/favicon.svg`,
  email: EMAIL,
  priceRange: "$$",
  address: { "@type": "PostalAddress", addressLocality: "Detroit", addressRegion: "MI", addressCountry: "US" },
  areaServed: AREAS.map((name) => ({ "@type": "Place", name })),
  knowsAbout: ["Real estate photography", "Drone aerial photography", "Listing video", "Twilight photography"],
};

function crumbs(trail) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [["Home", "/"], ...trail].map(([name, url], i) => ({
      "@type": "ListItem", position: i + 1, name, item: `${SITE}${url === "/" ? "/" : url}`,
    })),
  };
}

// Everything between the markers is ours. Placed right after the description.
function seoBlock({ url, title, description, descTpl, image, type = "website", extra = [] }) {
  const abs = `${SITE}${url}`;
  const img = `${SITE}${image || OG_IMAGE}`;
  const dp = descTpl ? ` data-price="${esc(descTpl)}"` : "";
  return [
    "<!-- seo: written by scripts/build-seo.mjs, edit there -->",
    `<link rel="canonical" href="${abs}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:site_name" content="EZ Shots" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description"${dp} content="${esc(description)}" />`,
    `<meta property="og:url" content="${abs}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description"${dp} content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${img}" />`,
    ...extra.map(ld),
    "<!-- /seo -->",
  ].map((l) => "  " + l).join("\n");
}

function inject(html, block) {
  html = html.replace(/\n\s*<!-- seo:[\s\S]*?<!-- \/seo -->/, "");
  const desc = html.match(/\n\s*<meta name="description"[^>]*>/);
  const at = desc ? desc.index + desc[0].length : html.indexOf("</title>") + 8;
  return html.slice(0, at) + "\n" + block + html.slice(at);
}

function pageMeta(html) {
  const title = unesc((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "EZ Shots").trim();
  const tag = (html.match(/<meta name="description"[^>]*>/) || [""])[0];
  const description = unesc((tag.match(/content="([^"]*)"/) || [])[1] || "");
  const descTpl = (tag.match(/data-price="([^"]*)"/) || [])[1];
  return { title, description, descTpl: descTpl ? unesc(descTpl) : null };
}

function faqSchema(html) {
  const qa = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>\s*<div class="answer">([\s\S]*?)<\/div>\s*<\/details>/g)];
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map(([, q, a]) => ({ "@type": "Question", name: strip(q), acceptedAnswer: { "@type": "Answer", text: strip(a) } })),
  };
}

/* ---------------------------------------------------------------------------
 * The blog
 * ------------------------------------------------------------------------- */

const posts = fs.existsSync(path.join(ROOT, "scripts/blog-posts.json"))
  ? JSON.parse(read("scripts/blog-posts.json")) : [];

// The package prices are bound to the live config like the rest of the
// site's copy (see js/prices.js), so an article never quotes a stale price.
// $0 and $20 are the offer, not a package price, and stay as written. $100 is
// not bound on purpose: articles also say other photographers charge "$100 to
// $175" for aerials, and that must not move with the video price.
const PRICE_TOKENS = { "$99": "{media.first}", "$199": "{media}", "$299": "{media+video}" };
const prose = (s) => esc(s).replace(/\$(99|199|299)\b/g, (m) => `<span data-price="${PRICE_TOKENS[m]}">${m}</span>`);

const LINKS = [
  ["/book", "Book a shoot, $0 down"],
  ["/packages", "Pricing and packages"],
  ["/guarantee", "The not happy, do not pay guarantee"],
  ["/services", "Photo, video and drone services"],
  ["/portfolio", "Recent homes we shot"],
  ["/areas", "Areas we serve in Metro Detroit"],
];

const THEME = `<script>(function(){try{var t=localStorage.getItem("theme");if(!t){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.setAttribute("data-theme",t);}catch(e){}})();</script>`;

const CTA = `  <section class="cta-band">
    <div class="container">
      <h2>Your next listing, shot and back in about 24 hours.</h2>
      <p>$0 to book. Pay after you see the photos, and if you are not happy you do not pay and you get $20.</p>
      <div class="btn-row center">
        <a href="/book" class="btn btn-lg btn-white">Book a shoot</a>
        <a href="/guarantee" class="btn btn-lg btn-outline-white">Read the guarantee</a>
      </div>
    </div>
  </section>`;

function shell({ file, title, description, page, head, body, scripts = [] }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
${head}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="/css/styles.css" />
  ${THEME}
</head>
<body data-page="${page}">
  <!-- Built by scripts/build-seo.mjs from scripts/blog-posts.json. Edit there, then npm run seo. -->
  <div id="site-header"></div>
${body}

  <div id="site-footer"></div>
${["/js/site.js", ...scripts].map((s) => `  <script src="${s}"></script>`).join("\n")}
</body>
</html>
`;
}

function block(b) {
  switch (b.type) {
    case "h2": return `      <h2>${prose(b.text)}</h2>`;
    case "p": return `      <p>${prose(b.text)}</p>`;
    case "ul": case "ol":
      return `      <${b.type}>\n${b.items.map((i) => `        <li>${prose(i)}</li>`).join("\n")}\n      </${b.type}>`;
    case "image":
      return `      <img class="post-img" src="${esc(b.url)}" alt="${esc(b.alt)}" width="1280" height="720" loading="lazy" decoding="async" />`;
    default: return "";
  }
}

const postUrl = (p) => `/blog/${p.slug}`;
const wordsOf = (p) => p.blocks.map((b) => b.text || (b.items || []).join(" ")).join(" ").split(/\s+/).filter(Boolean).length;

for (const p of posts) {
  const url = postUrl(p);
  const title = `${p.title} | EZ Shots`;
  const hasPrice = p.blocks.some((b) => /\$(150|75|250|125)\b/.test(b.text || (b.items || []).join(" ")));
  const article = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: p.title,
    description: p.description,
    mainEntityOfPage: `${SITE}${url}`,
    ...(p.image ? { image: [`${SITE}${p.image}`] } : {}),
    keywords: p.keyword,
    wordCount: wordsOf(p),
    inLanguage: "en-US",
    author: { "@type": "Organization", name: "EZ Shots", url: `${SITE}/` },
    publisher: { "@type": "Organization", name: "EZ Shots", url: `${SITE}/`, logo: { "@type": "ImageObject", url: `${SITE}/favicon.svg` } },
  };
  // Three related reads, chosen by position so every post links to different
  // neighbours and every post is linked from at least three others.
  const i = posts.indexOf(p);
  const related = [1, 2, 3].map((d) => posts[(i + d) % posts.length]).filter((x) => x && x !== p);

  const body = `  <main id="main">
  <article class="post">
    <div class="container post-wrap">
      <a href="/blog" class="post-back">&larr; All articles</a>
      <h1>${esc(p.title)}</h1>
${p.image ? `      <img class="post-hero" src="${esc(p.image)}" alt="${esc(p.imageAlt || p.title)}" width="1280" height="720" fetchpriority="high" />\n` : ""}      <div class="post-body">
${p.blocks.map(block).join("\n")}
      </div>
      <footer class="post-foot">
        <div class="post-foot-h">More on EZ Shots</div>
        <ul class="post-links">
${LINKS.map(([h, l]) => `          <li><a href="${h}">${esc(l)}</a></li>`).join("\n")}
        </ul>
        <div class="post-foot-h" style="margin-top:28px">Keep reading</div>
        <ul class="post-links">
${related.map((r) => `          <li><a href="${postUrl(r)}">${esc(r.title)}</a></li>`).join("\n")}
        </ul>
      </footer>
    </div>
  </article>
  </main>

${CTA}`;

  write(`blog/${p.slug}.html`, shell({
    title, description: p.description, page: "blog",
    head: seoBlock({ url, title: p.title, description: p.description, image: p.image, type: "article",
      extra: [article, crumbs([["Blog", "/blog"], [p.title, url]])] }),
    body, scripts: hasPrice ? ["/js/config.js", "/js/prices.js"] : [],
  }));
}

// Remove pages for posts that are no longer in the JSON.
if (fs.existsSync(path.join(ROOT, "blog"))) {
  const keep = new Set(posts.map((p) => `${p.slug}.html`));
  for (const f of fs.readdirSync(path.join(ROOT, "blog"))) if (f.endsWith(".html") && !keep.has(f)) fs.unlinkSync(path.join(ROOT, "blog", f));
}

{
  const title = "Real Estate Photography Blog for Realtors | EZ Shots";
  const description = "Plain, practical guides for Metro Detroit realtors on listing photos, drone aerials, listing video, prepping a house for the shoot and getting more clicks on the MLS.";
  const list = posts.map((p) => `        <li>
          <a href="${postUrl(p)}" class="blog-card">
${p.image ? `            <img src="${esc(p.image)}" alt="" width="320" height="180" loading="lazy" decoding="async" />\n` : ""}            <div>
              <h2>${esc(p.title)}</h2>
              <p>${prose(p.excerpt || p.description)}</p>
            </div>
          </a>
        </li>`).join("\n");
  const body = `  <section id="main" class="page-head">
    <div class="container">
      <p class="eyebrow">Blog</p>
      <h1>Guides for better listing photos</h1>
      <p class="lead">Short, honest pieces for realtors about photos, drone, video and getting a listing ready to shoot.</p>
    </div>
  </section>

  <section class="section-sm">
    <div class="container narrow">
${posts.length ? `      <ul class="blog-list">\n${list}\n      </ul>` : `      <p class="tiny">The first articles are on their way. Check back soon.</p>`}
    </div>
  </section>

${CTA}`;
  const itemList = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "The EZ Shots blog",
    url: `${SITE}/blog`,
    publisher: { "@id": `${SITE}/#business` },
    blogPost: posts.map((p) => ({ "@type": "BlogPosting", headline: p.title, url: `${SITE}${postUrl(p)}` })),
  };
  write("blog.html", shell({
    title, description, page: "blog",
    head: seoBlock({ url: "/blog", title: "The EZ Shots blog", description, extra: [itemList, crumbs([["Blog", "/blog"]])] }),
    body, scripts: posts.some((p) => /\$(150|75|250|125)\b/.test(p.excerpt || "")) ? ["/js/config.js", "/js/prices.js"] : [],
  }));
}

/* ---------------------------------------------------------------------------
 * Every other public page's head
 * ------------------------------------------------------------------------- */

for (const [file, url, crumb] of PAGES) {
  if (file === "blog.html") continue;
  let html = read(file);
  const meta = pageMeta(html);
  const extra = [];
  if (file === "index.html") extra.push(BUSINESS, { "@context": "https://schema.org", "@type": "WebSite", name: "EZ Shots", url: `${SITE}/` });
  if (file === "faq.html") extra.push(faqSchema(html));
  if (file === "services.html" || file === "packages.html") {
    extra.push({
      "@context": "https://schema.org", "@type": "Service", serviceType: "Real estate photography",
      provider: { "@id": `${SITE}/#business` }, areaServed: AREAS.slice(0, 3),
      name: meta.title, description: meta.description,
    });
  }
  if (crumb) extra.push(crumbs([[crumb, url]]));
  html = inject(html, seoBlock({ url, ...meta, extra }));
  write(file, html);
}

/* ---------------------------------------------------------------------------
 * sitemap.xml and robots.txt
 * ------------------------------------------------------------------------- */

const projectIds = [...read("js/projects.js").matchAll(/"id":\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
const urls = [
  ...PAGES.map(([, u]) => u),
  ...posts.map(postUrl),
  ...projectIds.map((id) => `/project?id=${id}`),
];
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(SITE + u)}</loc></url>`).join("\n")}
</urlset>
`);

write("robots.txt", `User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin-settings
Disallow: /api/
Disallow: /manage
Disallow: /booked
Disallow: /intake

Sitemap: ${SITE}/sitemap.xml
`);

console.log(`${posts.length} posts, ${PAGES.length} pages, ${urls.length} sitemap urls`);
