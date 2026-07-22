"use client";

import { createContext, useContext } from "react";

/**
 * Whether the demo scaffolding is visible, made available to client components
 * without threading a prop through every form.
 *
 * The problem this fixes: the "Fill test data" button sat unconditionally on
 * `/signup`, which is a **public page**. Anyone who found it saw a dev
 * affordance on the first screen of a product asking restaurant owners to trust
 * it with their payments. The comments said "remove before launch", which is a
 * plan that depends on someone remembering at exactly the wrong moment.
 *
 * Now it's a platform switch an admin owns (`/admin/tools`, Mode tab), off by default,
 * with the admin page stating plainly that turning it on exposes a button on a
 * public page.
 *
 * Defaults to `false`, so a component rendered outside a provider hides the
 * tooling rather than showing it. The safe direction for a default is the one
 * where forgetting to wire something up leaks nothing.
 */
const TestModeContext = createContext(false);

export function TestModeProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return <TestModeContext.Provider value={enabled}>{children}</TestModeContext.Provider>;
}

export function useTestMode(): boolean {
  return useContext(TestModeContext);
}

/** Renders its children only when the platform's test tooling is switched on. */
export function TestOnly({ children }: { children: React.ReactNode }) {
  return useContext(TestModeContext) ? <>{children}</> : null;
}
