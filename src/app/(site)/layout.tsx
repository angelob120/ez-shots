import { getSession } from "@/lib/auth";
import { getTheme, themeAttr } from "@/lib/theme";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const home = session ? (session.role === "ADMIN" ? "/admin" : "/dashboard") : null;

  return (
    <div
      className="hearth-shell flex min-h-screen flex-col"
      data-h-theme={themeAttr(getTheme())}
    >
      <SiteHeader home={home} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
