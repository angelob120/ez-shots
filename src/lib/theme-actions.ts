"use server";

import { revalidatePath } from "next/cache";
import { isTheme, setThemeCookie, type Theme } from "./theme";

/**
 * Deliberately unauthenticated. Every other action in this codebase is scoped
 * by `requireOwner()` or `requireAdmin()`, but this one writes a cookie in the
 * caller's own browser and reads nothing — there is no tenant to isolate and
 * no data to leak. Gating it would only break the toggle on `/login`, which is
 * the first dark page a new owner ever sees.
 */
export async function setThemeAction(next: Theme) {
  if (!isTheme(next)) return;
  setThemeCookie(next);

  // The layouts that render the shell are `force-dynamic`, so the attribute is
  // recomputed on the next render regardless; this just makes that render
  // happen now rather than on the user's next navigation.
  revalidatePath("/", "layout");
}
