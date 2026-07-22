import Link from "next/link";

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="relative flex h-6 w-6 items-center justify-center rounded-[7px] bg-accent">
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path
            d="M6 9h12l-1.2 9.2a1.6 1.6 0 0 1-1.6 1.4H8.8a1.6 1.6 0 0 1-1.6-1.4L6 9Z"
            fill="#ffffff"
          />
          <path d="M9 9V7.6a3 3 0 0 1 6 0V9" stroke="#ffffff" strokeWidth="1.8" fill="none" />
        </svg>
      </span>
      <span
        className="font-semibold tracking-tight text-ink"
        style={{ fontSize: size, letterSpacing: "-0.02em" }}
      >
        EZ Orders
      </span>
    </span>
  );
}

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#numbers", label: "Why it pays" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader({ home }: { home: string | null }) {

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-base/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1140px] items-center gap-8 px-6">
        <Link href="/" aria-label="EZ Orders home">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded-sm px-3 py-2 text-[13px] text-dim transition-colors hover:bg-surface2 hover:text-ink"
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {home ? (
            <Link
              href={home}
              className="inline-flex h-9 items-center rounded-sm bg-accent px-4 text-[13px] font-semibold text-[#ffffff] transition-colors hover:bg-[#60a5fa]"
            >
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex h-9 items-center rounded-sm px-3 text-[13px] font-medium text-dim transition-colors hover:bg-surface2 hover:text-ink"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="inline-flex h-9 items-center rounded-sm bg-accent px-4 text-[13px] font-semibold text-[#ffffff] transition-colors hover:bg-[#60a5fa]"
              >
                Start free
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-base">
      <div className="mx-auto max-w-[1140px] px-6 py-14">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-[300px]">
            <Wordmark />
            <p className="mt-3 text-[13px] leading-relaxed text-dim">
              Ordering, rewards, and text marketing for independent restaurants. No monthly fee.
            </p>
          </div>

          {/*
            Four columns, because there are four. This was `sm:grid-cols-3`
            when Legal was added, which left it orphaned on a second row
            looking like a rendering fault rather than a column.
          */}
          <div className="grid grid-cols-2 gap-x-10 gap-y-8 text-[13px] sm:grid-cols-4">
            <FooterCol
              title="Product"
              links={[
                ["How it works", "/#how"],
                ["Pricing", "/pricing"],
                ["FAQ", "/#faq"],
              ]}
            />
            <FooterCol
              title="Get started"
              links={[
                ["Create an account", "/signup"],
                ["Log in", "/login"],
              ]}
            />
            <FooterCol
              title="Contact"
              links={[
                ["Send a message", "/contact"],
                ["hello@ezorders.app", "mailto:hello@ezorders.app"],
              ]}
            />
            {/*
              Four policies, not ten, and the same four as the storefront
              footer. The full set is one click further, from the bottom bar —
              a footer listing every document buries the two anyone is actually
              looking for, which is the same failure as hiding them.
            */}
            <FooterCol
              title="Legal"
              links={[
                ["Terms", "/legal/terms"],
                ["Privacy", "/legal/privacy"],
                ["Refunds", "/legal/refunds"],
                ["Text messaging", "/legal/messaging"],
              ]}
            />
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-[12px] text-mute sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} EZ Orders</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href="/legal" className="transition-colors hover:text-ink">
              All policies
            </Link>
            <span aria-hidden>·</span>
            <span>Texts are opt-in only. Customers can reply STOP at any time.</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">
        {title}
      </div>
      <ul className="space-y-2">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-dim transition-colors hover:text-ink">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
