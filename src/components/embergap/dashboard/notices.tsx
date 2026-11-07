/** Required on every EmberGap page: filing a report is not calling for help. */
export function SafetyNotice() {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      <span className="font-semibold">In danger now?</span> Call 999 (UK), 112 (EU) or 911 (US). EmberGap doesn&apos;t
      confirm fires or dispatch help.
    </p>
  );
}
