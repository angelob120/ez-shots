import Link from "next/link";
import { redirect } from "next/navigation";
import { lookupInvite } from "@/lib/invites";
import { getSession } from "@/lib/auth";
import { getTheme, themeAttr } from "@/lib/theme";
import AcceptInviteForm from "./AcceptInviteForm";

export const dynamic = "force-dynamic";

// An invite is a credential in a URL. Keeping it out of search indexes is the
// cheapest half of not leaking it; the other half is that it expires.
export const metadata = { robots: { index: false, follow: false } };

/** What to say for each dead state, and whether there's anything to do about it. */
const DEAD: Record<string, { title: string; body: string }> = {
  expired: {
    title: "This link has expired",
    body: "Invite links are good for a few days. Ask whoever sent it to generate a fresh one — it takes them a couple of seconds.",
  },
  used: {
    title: "This link has already been used",
    body: "The account it created is ready. Sign in with the email address the invite was sent to.",
  },
  revoked: {
    title: "This link was cancelled",
    body: "Someone replaced or withdrew this invite. Ask for a current one.",
  },
  unknown: {
    title: "This link isn't valid",
    body: "Check you copied the whole address — invite links are long and easy to truncate in a message.",
  },
};

export default async function InvitePage({ params }: { params: { token: string } }) {
  // Redeeming while signed in as somebody else is a footgun: the new session
  // would silently replace the old one. Send them out cleanly instead.
  const session = await getSession();
  if (session) redirect(session.restaurantId ? "/dashboard" : "/admin");

  const state = await lookupInvite(params.token);

  return (
    <div
      className="hearth-shell flex items-center justify-center px-6 py-16"
      data-h-theme={themeAttr(getTheme())}
    >
      <div className="w-full max-w-[400px]">
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
            <span className="text-[14px] font-semibold tracking-tight text-ink">EZ Orders</span>
          </div>

          {state.status === "valid" ? (
            <>
              <h1 className="text-[22px] font-semibold tracking-tight text-ink">
                Set up your login
              </h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
                You&rsquo;ve been invited to manage{" "}
                <span className="text-ink">{state.restaurantName}</span>. Pick a password and
                you&rsquo;re in — we&rsquo;ll walk you through the rest.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-[22px] font-semibold tracking-tight text-ink">
                {DEAD[state.status].title}
              </h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
                {DEAD[state.status].body}
              </p>
            </>
          )}
        </div>

        {state.status === "valid" ? (
          <AcceptInviteForm token={params.token} email={state.email} />
        ) : (
          <Link
            href="/login"
            className="inline-flex h-9 items-center justify-center rounded-sm border border-line2 px-4 text-[13px] font-medium text-ink transition-colors hover:bg-surface2"
          >
            Go to sign in
          </Link>
        )}
      </div>
    </div>
  );
}
