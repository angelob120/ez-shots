"use client";

import { useEffect } from "react";

export default function RegisterSW({ scope }: { scope: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      /* non-fatal */
    });
  }, [scope]);
  return null;
}
