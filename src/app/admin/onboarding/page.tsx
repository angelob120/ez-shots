import { requireAdmin } from "@/lib/auth";
import { SectionTitle } from "@/components/hearth/ui";
import { getStepTemplate, type EditableStep } from "@/lib/onboarding-checklist";
import StepTemplateEditor from "./StepTemplateEditor";

export const dynamic = "force-dynamic";

export default async function OnboardingTemplatePage() {
  await requireAdmin();

  // Resilient to migration 34 not having run yet — the wording lives in a
  // PlatformSetting column added by it; getStepTemplate falls back to code
  // defaults if the read fails, so this page still renders.
  let steps: EditableStep[];
  try {
    steps = await getStepTemplate();
  } catch {
    steps = [];
  }

  return (
    <>
      <SectionTitle
        title="Onboarding checklist"
        subtitle="The master checklist every restaurant is walked through. Edit the wording here; it applies to all accounts."
      />
      <StepTemplateEditor steps={steps} />
    </>
  );
}
