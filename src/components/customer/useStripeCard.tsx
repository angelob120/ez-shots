"use client";

import React from "react";

/**
 * The card field, kept deliberately small.
 *
 * Loads Stripe.js from Stripe's own CDN (it must be served from there — a
 * self-hosted copy voids PCI SAQ-A eligibility, which is the entire reason the
 * card number never touches our origin) and mounts a single Card Element. The
 * component that renders `<CardMount />` gets nothing back but a DOM node; the
 * card details live inside Stripe's iframe and are never readable by our code.
 *
 * The hook exposes two verbs the checkout needs:
 *   - createPaymentMethod(): tokenize what's in the field into a `pm_...` id.
 *   - confirmChallenge(clientSecret): run a 3-D Secure step the server asked
 *     for, then report whether it cleared.
 *
 * When card collection is off (test mode with no publishable key, or the stub),
 * the hook is inert: `ready` is false, `CardMount` renders nothing, and the
 * checkout falls through to the no-card path unchanged.
 */

const STRIPE_JS = "https://js.stripe.com/v3";

type StripeCard = {
  ready: boolean;
  /** True once Stripe.js and the Element have mounted and can be used. */
  mounted: boolean;
  error: string | null;
  CardMount: React.FC;
  /** Tokenize the entered card. Returns the payment method id, or throws. */
  createPaymentMethod: () => Promise<string>;
  /** Finish a 3-D Secure challenge. Resolves true when the intent is authorised. */
  confirmChallenge: (clientSecret: string) => Promise<boolean>;
  /**
   * Confirm a **SetupIntent** and return the resulting payment method.
   *
   * Saving a card for later is a different Stripe object from charging one now,
   * and the subscription flow needs the first: no money moves, the card is
   * stored against the customer, and it is charged monthly while nobody is
   * present. Used by the plan page, on the *platform* account — note callers
   * there pass `stripeAccount: null`, because an owner paying us is not a diner
   * paying a restaurant.
   */
  confirmCardSetup: (clientSecret: string) => Promise<string>;
};

export function useStripeCard(config: {
  cardEnabled: boolean;
  publishableKey: string | null;
  /**
   * The restaurant's connected account. Charges are direct — created on that
   * account — and a PaymentMethod is scoped to whichever account tokenized it,
   * so the card has to be tokenized there too or the server's charge won't be
   * able to use it. Null before the owner has onboarded, which only happens in
   * test mode, where the charge falls back to the platform account.
   */
  stripeAccount: string | null;
}): StripeCard {
  const enabled = config.cardEnabled && !!config.publishableKey;

  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const stripeRef = React.useRef<any>(null);
  const cardRef = React.useRef<any>(null);
  const [mounted, setMounted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
        const Stripe = await loadStripeJs();
        if (cancelled) return;
        // Same account the server will create the intent on. Both sides have
        // to agree or the pm_... is unusable by the charge.
        const stripe = config.stripeAccount
          ? Stripe(config.publishableKey, { stripeAccount: config.stripeAccount })
          : Stripe(config.publishableKey);
        const elements = stripe.elements();
        const card = elements.create("card", {
          // Match the storefront's own tokens rather than Stripe's default blue,
          // so the field doesn't read as a bolted-on third-party widget.
          style: {
            base: {
              fontSize: "16px",
              color: "var(--s-ink, #111)",
              "::placeholder": { color: "var(--s-mute, #999)" },
            },
          },
        });
        stripeRef.current = stripe;
        cardRef.current = card;

        // The ref can lag the effect on the very first paint; wait a tick for it.
        const mount = () => {
          if (cancelled) return;
          if (mountRef.current) {
            card.mount(mountRef.current);
            card.on("change", (e: any) => setError(e.error?.message ?? null));
            setMounted(true);
          } else {
            requestAnimationFrame(mount);
          }
        };
        mount();
      } catch (e) {
        if (!cancelled) {
          setError("Couldn't load the secure card field. Refresh and try again.");
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        cardRef.current?.destroy();
      } catch {
        // Element already gone — nothing to clean up.
      }
    };
    // publishableKey is stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const createPaymentMethod = React.useCallback(async (): Promise<string> => {
    if (!stripeRef.current || !cardRef.current) {
      throw new Error("Card field isn't ready yet.");
    }
    const { paymentMethod, error: pmError } = await stripeRef.current.createPaymentMethod({
      type: "card",
      card: cardRef.current,
    });
    if (pmError) throw new Error(pmError.message ?? "That card couldn't be read.");
    return paymentMethod.id as string;
  }, []);

  const confirmChallenge = React.useCallback(
    async (clientSecret: string): Promise<boolean> => {
      if (!stripeRef.current) throw new Error("Card field isn't ready yet.");
      // The card is already on the intent from the server-side confirm; this
      // only runs the authentication step and reports the outcome.
      const { error: confirmError, paymentIntent } =
        await stripeRef.current.confirmCardPayment(clientSecret);
      if (confirmError) throw new Error(confirmError.message ?? "Authentication failed.");
      return paymentIntent?.status === "succeeded" || paymentIntent?.status === "requires_capture";
    },
    []
  );

  const confirmCardSetup = React.useCallback(async (clientSecret: string): Promise<string> => {
    if (!stripeRef.current || !cardRef.current) throw new Error("Card field isn't ready yet.");
    const { error: setupError, setupIntent } = await stripeRef.current.confirmCardSetup(
      clientSecret,
      { payment_method: { card: cardRef.current } }
    );
    if (setupError) throw new Error(setupError.message ?? "That card couldn't be saved.");
    const pm = setupIntent?.payment_method;
    if (typeof pm !== "string") throw new Error("That card couldn't be saved.");
    return pm;
  }, []);

  const CardMount = React.useCallback<React.FC>(
    () => (enabled ? <div ref={mountRef} /> : null),
    [enabled]
  );

  return {
    ready: enabled,
    mounted,
    error,
    CardMount,
    createPaymentMethod,
    confirmChallenge,
    confirmCardSetup,
  };
}

/** Injects Stripe.js once and resolves the global constructor. */
let stripeJsPromise: Promise<any> | null = null;
function loadStripeJs(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  const w = window as any;
  if (w.Stripe) return Promise.resolve(w.Stripe);
  if (stripeJsPromise) return stripeJsPromise;

  stripeJsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${STRIPE_JS}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve((window as any).Stripe));
      existing.addEventListener("error", () => reject(new Error("Stripe.js failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = STRIPE_JS;
    script.async = true;
    script.onload = () => resolve((window as any).Stripe);
    script.onerror = () => reject(new Error("Stripe.js failed to load"));
    document.head.appendChild(script);
  });
  return stripeJsPromise;
}
