import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { emailProviderConfigured } from "@/lib/email";
import ActionForm from "@/components/hearth/ActionForm";
import { Badge, Button, Card, Field, Input, SectionTitle } from "@/components/hearth/ui";
import { saveEmailSenderAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Who the restaurant's marketing email claims to be from.
 *
 * The important thing this page has to communicate is *why the owner can't
 * just type their address and have it work*. Email authentication is invisible
 * and unforgiving: mail sent from an address whose domain hasn't authorised
 * our servers fails DMARC and lands in spam, silently, with every metric
 * saying it was delivered. An owner who typed their address here and saw it
 * accepted would reasonably assume it was in use, and would learn otherwise
 * from a campaign nobody replied to.
 *
 * So the address is stored, the from-line keeps using the platform sender under
 * the restaurant's *name* until verification lands, and the page says so
 * plainly rather than showing a green tick for a saved form field.
 */
export default async function SenderPage() {
  const { restaurantId } = await requireOwner();

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      name: true,
      address: true,
      city: true,
      emailFrom: true,
      emailFromName: true,
      emailReplyTo: true,
      emailFooterAddress: true,
      emailSenderVerifiedAt: true,
    },
  });
  if (!restaurant) return null;

  const verified = !!restaurant.emailSenderVerifiedAt;
  const platformFallback = process.env.EMAIL_FROM || "not configured";
  const live = emailProviderConfigured();

  return (
    <>
      <SectionTitle
        title="Email sender"
        subtitle="What your customers see in the from-line, and the address the law requires in the footer."
        action={
          <Link href="/dashboard/marketing" className="text-[12px] text-dim hover:text-ink">
            ← Marketing
          </Link>
        }
      />

      <Card className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] text-ink">
              Currently sending as{" "}
              <span className="font-mono text-[12px]">
                {restaurant.emailFromName || restaurant.name} &lt;
                {verified ? restaurant.emailFrom : platformFallback}&gt;
              </span>
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-mute">
              {verified
                ? "Your own domain is verified and in use."
                : "Your restaurant's name, our sending address. This is deliberate — mail from an unverified domain fails authentication checks and goes to spam, so we use an address that passes them until yours is set up. Your customers still see your name."}
            </p>
          </div>
          <Badge tone={!live ? "warn" : verified ? "good" : "neutral"}>
            {!live ? "not sending" : verified ? "verified" : "platform sender"}
          </Badge>
        </div>
      </Card>

      <Card>
        <ActionForm action={saveEmailSenderAction} className="max-w-lg space-y-4">
          <Field label="From name" hint="What shows in the inbox. Usually just your restaurant's name.">
            <Input
              name="emailFromName"
              defaultValue={restaurant.emailFromName ?? restaurant.name}
              maxLength={78}
            />
          </Field>

          <Field
            label="From address (optional)"
            hint="An address on a domain you own. We'll verify it with the email provider before using it — that takes a DNS record and isn't instant."
          >
            <Input
              name="emailFrom"
              type="email"
              defaultValue={restaurant.emailFrom ?? ""}
              placeholder="hello@yourrestaurant.com"
            />
          </Field>

          <Field
            label="Reply-to address"
            hint="Where replies land. Worth setting even if you use our sending address — nobody reads that inbox, and a customer who replies and hears nothing back is worse off than before you emailed."
          >
            <Input
              name="emailReplyTo"
              type="email"
              defaultValue={restaurant.emailReplyTo ?? ""}
              placeholder="orders@yourrestaurant.com"
            />
          </Field>

          <Field
            label="Postal address in the footer"
            hint="Required by law in every marketing email. Defaults to your restaurant's address."
          >
            <Input
              name="emailFooterAddress"
              defaultValue={
                restaurant.emailFooterAddress ??
                [restaurant.address, restaurant.city].filter(Boolean).join(", ")
              }
              maxLength={200}
            />
          </Field>

          <Button type="submit">Save</Button>
        </ActionForm>
      </Card>
    </>
  );
}
