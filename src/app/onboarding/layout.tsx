import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { testModeEnabled } from "@/lib/payments";
import { TestModeProvider } from "@/components/hearth/TestMode";
import ThemeToggle from "@/components/hearth/ThemeToggle";
import { getTheme, themeAttr } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  // The wizard's autofill buttons are demo scaffolding, not product. One
  // platform switch decides whether an owner setting up for real ever sees them.
  const testMode = await testModeEnabled();
  const theme = getTheme();

  return (
    <TestModeProvider enabled={testMode}>
      <div className="hearth-shell" data-h-theme={themeAttr(theme)}>
        <header className="border-b border-line bg-base/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[760px] items-center gap-3 px-6">
            <Link href="/onboarding" className="flex shrink-0 items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
              <span className="whitespace-nowrap text-[14px] font-semibold tracking-tight text-ink">
                EZ Orders
              </span>
            </Link>
            <span className="shrink-0 whitespace-nowrap text-[13px] text-mute">Setup</span>
            <div className="ml-auto shrink-0">
              <ThemeToggle theme={theme} />
            </div>
            <form action={logoutAction} className="shrink-0">
              <button className="whitespace-nowrap rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim transition-colors hover:text-ink">
                Save &amp; sign out
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-[760px] px-6 py-10">{children}</main>
      </div>
    </TestModeProvider>
  );
}
