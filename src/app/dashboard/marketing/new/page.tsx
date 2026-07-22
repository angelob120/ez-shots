import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listSegments } from "@/lib/customers";
import { channelReadiness } from "@/lib/campaigns";
import { SectionTitle } from "@/components/hearth/ui";
import Composer from "../Composer";
import { createCampaignAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const { restaurantId } = await requireOwner();

  const [restaurant, segments, readiness] = await Promise.all([
    prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true } }),
    listSegments(restaurantId),
    channelReadiness(restaurantId),
  ]);

  return (
    <>
      <SectionTitle
        title="New campaign"
        subtitle="Nothing sends from this screen. You'll see the audience and confirm on the next one."
      />
      <Composer
        action={createCampaignAction}
        restaurantName={restaurant?.name ?? ""}
        segments={segments.map((s) => ({ id: s.id, name: s.name, query: s.query }))}
        submitLabel="Save and review"
        smsLive={readiness.sms.live && readiness.sms.hasSender && !readiness.sms.suspended}
        emailLive={readiness.email.live && !readiness.email.suspended}
      />
    </>
  );
}
