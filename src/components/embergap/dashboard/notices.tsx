import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Shown on every EmberGap review page. Filing a report is not calling for help. */
export function SafetyNotice() {
  return (
    <Alert>
      <AlertTitle>Not an emergency service</AlertTitle>
      <AlertDescription>
        If anyone is in immediate danger, contact local emergency services now (999 in the UK,
        112 in the EU, 911 in the US). EmberGap is a research prototype that helps people review
        evidence. It does not confirm fires, send alerts or dispatch anyone. Never move towards a
        possible fire to gather evidence.
      </AlertDescription>
    </Alert>
  );
}

export function DemoDataNotice({ satelliteLive }: { satelliteLive: boolean }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Demo data.</span>{" "}
      {satelliteLive
        ? "Satellite detections are live NASA FIRMS data. Every report and investigation is synthetic."
        : "Every report, investigation and satellite detection shown here is synthetic. None of these events happened."}
    </p>
  );
}
