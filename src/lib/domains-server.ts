import "server-only";
import { promises as dns } from "node:dns";
import { DOMAIN_CHALLENGE_PREFIX } from "./domains";

/**
 * Confirm the owner published our challenge token as a TXT record at
 * `_hearth-challenge.<domain>`. This proves they control the domain's DNS
 * before we start routing traffic to their store.
 */
export async function verifyDomainChallenge(
  domain: string,
  token: string
): Promise<{ ok: boolean; reason?: string }> {
  const name = `${DOMAIN_CHALLENGE_PREFIX}.${domain}`;
  try {
    const records = await dns.resolveTxt(name);
    // resolveTxt returns string[][] (each record can be split into chunks).
    const flat = records.map((chunks) => chunks.join("").trim());
    if (flat.includes(token)) return { ok: true };
    return {
      ok: false,
      reason: `No matching TXT record found at ${name} yet. DNS changes can take a few minutes to propagate.`,
    };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return {
        ok: false,
        reason: `No TXT record found at ${name} yet. Add it and try again — DNS can take a few minutes.`,
      };
    }
    return { ok: false, reason: "Couldn't look up DNS for that domain. Try again shortly." };
  }
}
