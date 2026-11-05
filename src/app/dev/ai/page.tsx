import { PageHeader } from "@/components/page-header";
import { AiPanel } from "@/features/dev-smoke/components/ai-panel";
import { getAiConfig } from "@/lib/ai/config";
import { requireUser } from "@/lib/supabase/auth";

const MODE_DESCRIPTION = {
  anthropic: "Using the Anthropic API. Each request spends real credit.",
  mock: "Using the mock provider, with no network and no cost.",
  disabled: "Off. Set ANTHROPIC_API_KEY, or AI_PROVIDER=mock, then restart the server.",
};

export default async function DevAiPage() {
  await requireUser();
  const { mode } = getAiConfig();

  return (
    <>
      <PageHeader title="AI streaming" description={MODE_DESCRIPTION[mode]} />
      <AiPanel />
    </>
  );
}
