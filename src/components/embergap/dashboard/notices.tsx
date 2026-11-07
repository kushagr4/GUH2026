/** Required on every EmberGap page: filing a report is not calling for help. */
export function SafetyNotice() {
  return (
    <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-950 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
      <span className="font-semibold">In danger now?</span> Call 112 (Italy and the EU) or your local emergency number. EmberGap doesn&apos;t
      confirm fires or dispatch help.
    </p>
  );
}
