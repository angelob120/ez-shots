import Link from "next/link";
import { testModeEnabled } from "@/lib/payments";
import { getTheme, themeAttr } from "@/lib/theme";
import SignupForm from "./SignupForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Create your EZ Orders account" };

export default async function SignupPage() {
  // Public page. The autofill button used to sit here unconditionally, which is
  // a dev affordance on the first screen a restaurant owner ever sees.
  const testMode = await testModeEnabled();

  return (
    <div
      className="hearth-shell flex items-center justify-center px-6 py-16"
      data-h-theme={themeAttr(getTheme())}
    >
      <div className="w-full max-w-[420px]">
        <div className="mb-8">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
            <span className="text-[14px] font-semibold tracking-tight text-ink">EZ Orders</span>
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Create your account</h1>
          <p className="mt-1 text-[13px] text-dim">
            Set up your own ordering page and start building your customer list. Takes about five
            minutes.
          </p>
        </div>

        <SignupForm testMode={testMode} />

        <p className="mt-6 text-center text-[13px] text-dim">
          Already have an account?{" "}
          <Link href="/login" className="text-ink underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
