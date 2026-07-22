import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { SectionTitle } from "@/components/hearth/ui";
import FeeCalculator from "./FeeCalculator";

export const dynamic = "force-dynamic";

export default async function FeesPage() {
  await requireAdmin();

  const tenants = await prisma.restaurant.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      surchargePct: true,
      surchargeMinCts: true,
      surchargeMaxCts: true,
      surchargeLabel: true,
      taxPct: true,
    },
  });

  return (
    <>
      <SectionTitle
        title="Fee calculator"
        subtitle="Model the surcharge against any ticket size, using a tenant's live pricing. Admin only — owners see the rule, not the worked example."
      />
      <FeeCalculator tenants={tenants} />
    </>
  );
}
