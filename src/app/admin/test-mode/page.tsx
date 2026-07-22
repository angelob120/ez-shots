import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Gone — merged into `/admin/tools`.
 *
 * Payment mode and the testing workbench were two pages asking one question:
 * "is what I'm looking at real?". Keeping them apart meant the switch that
 * enables the tools lived on a different page from the tools, so the first
 * thing anyone did on a fresh environment was read an error telling them to
 * navigate somewhere else and come back. They're one page now, with mode as its
 * first tab.
 *
 * A redirect rather than a deletion, because this URL is in bookmarks, in the
 * deploy runbook, and in the error strings a few modules still raise. A 404 for
 * an admin hunting the payment-mode switch mid-incident is the worst possible
 * moment to make them go looking.
 */
export default function TestModeRedirect() {
  redirect("/admin/tools?tab=mode");
}
