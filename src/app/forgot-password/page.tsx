import { getTheme, themeAttr } from "@/lib/theme";
import ForgotForm from "./ForgotForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Reset your password - EZ Orders" };

export default function ForgotPasswordPage() {
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
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Reset your password</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-dim">
            Enter the email you sign in with and we&apos;ll send you a link to set a new password.
          </p>
        </div>
        <ForgotForm />
      </div>
    </div>
  );
}
