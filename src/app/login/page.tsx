import Link from "next/link";
import { getTheme, themeAttr } from "@/lib/theme";
import LoginForm from "./LoginForm";
import OAuthButtons from "@/components/hearth/OAuthButtons";

export const dynamic = "force-dynamic";

/**
 * The three sentinel values the OAuth routes use for failures that have no
 * useful detail. Everything else arrives already written for a human, from
 * `staffLinkDecision` or the exchange, and is passed through unchanged.
 */
function oauthMessage(raw: string): string {
  if (raw === "unavailable") return "That sign-in method isn't set up yet. Use your email and password.";
  if (raw === "unknown") return "That sign-in method isn't one we support.";
  if (raw === "failed") return "That sign-in didn't complete. Try again.";
  return raw;
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; oauth?: string };
}) {
  return (
    <div
      className="hearth-shell flex items-center justify-center px-6 py-16"
      data-h-theme={themeAttr(getTheme())}
    >
      <div className="w-full max-w-[380px]">
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
            <span className="text-[14px] font-semibold tracking-tight text-ink">EZ Orders</span>
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-[13px] text-dim">Operator access for admins and restaurant owners.</p>
        </div>
        {/*
          Surfaced above the form because a denied OAuth attempt is the one
          case where the reason matters and is not obvious — "there's no
          account for that address" is a different problem from a wrong
          password, and the fix is finding an invite rather than retrying.
        */}
        {searchParams.oauth && (
          <p className="mb-4 rounded-sm border border-warnLine bg-warnBg px-3 py-2 text-[12px] leading-relaxed text-warnInk">
            {oauthMessage(searchParams.oauth)}
          </p>
        )}

        <LoginForm next={searchParams.next ?? ""} />

        <div className="mt-6">
          <OAuthButtons next={searchParams.next} />
        </div>

        <p className="mt-6 text-center text-[13px] text-dim">
          New here?{" "}
          <Link href="/signup" className="text-ink underline underline-offset-2">
            Create a restaurant account
          </Link>
        </p>
      </div>
    </div>
  );
}
