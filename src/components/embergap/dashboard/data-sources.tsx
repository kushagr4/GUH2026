import { cn } from "cn";
import type { Provenance, SourceKind } from "@/lib/embergap/contracts";

/**
 * Where each piece of evidence comes from, in plain words, so a reader always
 * knows whether a row is a satellite, a weather model, a news-style event
 * feed, a person, or simulated demo data.
 */
export const SATELLITE_LABEL: Record<string, string> = {
  VIIRS_SNPP_NRT: "VIIRS · Suomi NPP",
  VIIRS_NOAA20_NRT: "VIIRS · NOAA-20",
  VIIRS_NOAA21_NRT: "VIIRS · NOAA-21",
  MODIS_NRT: "MODIS · Terra/Aqua",
  LANDSAT_NRT: "Landsat 8/9",
};

export function satelliteLabel(product: string | null | undefined): string {
  return (product && SATELLITE_LABEL[product]) ?? product ?? "Satellite";
}

/** The feed behind each source kind, as a short chip label. */
export const SOURCE_FEED: Record<SourceKind, { label: string; icon: string }> = {
  human: { label: "Eyewitness reports", icon: "👤" },
  firms: { label: "NASA FIRMS satellites", icon: "🛰" },
  weather: { label: "Open-Meteo weather", icon: "🌬" },
  eonet: { label: "NASA EONET events", icon: "🗂" },
  vision: { label: "Photo analysis", icon: "📷" },
};

/** A small pill: where the data came from, and whether it is live or simulated. */
export function SourceChip({
  icon,
  label,
  synthetic,
  wrap,
  className,
}: {
  icon?: string;
  label: string;
  synthetic?: boolean;
  /** Let a long label wrap instead of being cut short. */
  wrap?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 border px-2 py-0.5 text-[11px] leading-4 font-medium",
        wrap ? "rounded-lg" : "truncate rounded-full",
        synthetic
          ? "border-dashed border-stone-300 bg-stone-50 text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
          : "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
        className,
      )}
    >
      {icon ? <span aria-hidden>{icon}</span> : null}
      <span className={wrap ? undefined : "truncate"}>{label}</span>
      {synthetic === false ? (
        <span className="ml-0.5 rounded-sm bg-sky-100 px-1 text-[10px] uppercase dark:bg-sky-900">Live</span>
      ) : null}
    </span>
  );
}

/** "NASA FIRMS · VIIRS · NOAA-20" style label for a provenance record. */
export function provenanceLabel(provenance: Provenance): string {
  const product = provenance.provider === "NASA FIRMS" ? satelliteLabel(provenance.product) : provenance.product;
  return [provenance.provider, product].filter(Boolean).join(" · ");
}

