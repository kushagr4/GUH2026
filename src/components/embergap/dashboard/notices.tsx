import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { MapResponse } from "@/lib/embergap/contracts";

/** Shown on every EmberGap review page. Filing a report is not calling for help. */
export function SafetyNotice() {
  return (
    <Alert>
      <AlertTitle>Not an emergency service</AlertTitle>
      <AlertDescription>
        If anyone is in immediate danger, contact local emergency services now (999 in the UK, 112 in the EU, 911 in
        the US). EmberGap is a research prototype that helps people review evidence. It does not confirm fires, send
        alerts or dispatch anyone. Never move towards a possible fire to gather evidence.
      </AlertDescription>
    </Alert>
  );
}

const MODE_TEXT: Record<MapResponse["mode"], string> = {
  synthetic: "Every report, investigation and satellite detection shown here is synthetic. None of these events happened.",
  mixed: "Some items are synthetic demo data and some are live. Synthetic items are labelled.",
  live: "Live data. Reports are unverified claims, and thermal anomalies are not confirmed fires.",
};

export function DemoDataNotice({ mode }: { mode: MapResponse["mode"] }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{mode === "live" ? "Live data." : "Demo data."}</span>{" "}
      {MODE_TEXT[mode]}
    </p>
  );
}
