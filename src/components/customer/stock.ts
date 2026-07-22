/**
 * Curated stock food photography, used only where the tenant hasn't uploaded
 * their own.
 *
 * Shared by the marketing site and the ordering surface deliberately: a
 * restaurant mid-onboarding has half a menu photographed, and the two surfaces
 * falling back to *different* imagery is worse than either falling back alone —
 * the same dish would wear one photo on the landing page and another on the
 * menu. One list, one fallback, everywhere.
 */
export const STOCK = {
  hero: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1920&q=70",
  gallery: [
    "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1200&q=70",
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=70",
    "https://images.unsplash.com/photo-1533777324565-a040eb52facd?auto=format&fit=crop&w=1200&q=70",
    "https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?auto=format&fit=crop&w=1200&q=70",
    "https://images.unsplash.com/photo-1428515613728-6b4607e44363?auto=format&fit=crop&w=1200&q=70",
    "https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=1200&q=70",
  ],
  about:
    "https://images.unsplash.com/photo-1590846406792-0adc7f938f1d?auto=format&fit=crop&w=1400&q=70",
  dish: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=70",
};
