import Link from "next/link";
import { getTheme, themeAttr } from "@/lib/theme";
import { resolveResetToken } from "@/lib/password-reset";
import ResetForm from "./ResetForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Set a new password - EZ Orders" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token ?? "";
  const state = await resolveResetToken(token);

  const invalidMessage =
    state.ok === false
      ? state.reason === "expired"
        ? "This reset link has expired. Reset links are good for one hour."
        : state.reason === "used"
          ? "This reset link has already been used."
          : "This reset link isn't valid."
      : null;

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
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Set a new password</h1>
          {state.ok && (
            <p className="mt-1 text-[13px] text-dim">Choose a new password for your account.</p>
          )}
        </div>

        {state.ok ? (
          <ResetForm token={token} />
        ) : (
          <div className="space-y-4">
            <p className="rounded-sm border border-badLine bg-badBg px-4 py-3 text-[13px] leading-relaxed text-badInk">
              {invalidMessage}
            </p>
            <Link href="/forgot-password">
              <span className="block text-center text-[13px] text-ink underline underline-offset-2">
                Request a new reset link
              </span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
