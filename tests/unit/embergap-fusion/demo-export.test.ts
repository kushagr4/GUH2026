import { describe, expect, it } from "vitest";
import {
  DEMO_DISCLAIMER,
  DEMO_MIN_PUBLIC_PRECISION_M,
  buildDemoInvestigations,
  decimalsForPrecision,
  toApproxLocation,
} from "@/lib/embergap/agents/fusion/demo-export";
import { RAW_SCENARIOS } from "@/lib/embergap/agents/fusion/raw-scenarios";

const decimalsOf = (n: number) => (String(n).split(".")[1] ?? "").length;

describe("buildDemoInvestigations", () => {
  it("exports every raw scenario, labelled synthetic, with the disclaimer and expected outcome", async () => {
    const demo = await buildDemoInvestigations();
    expect(demo).toHaveLength(RAW_SCENARIOS.length);
    demo.forEach((inv, i) => {
      const s = RAW_SCENARIOS[i];
      expect(inv.id).toBe(s.investigationId);
      expect(inv.synthetic).toBe(true);
      expect(inv.mode).toBe("synthetic");
      expect(inv.title).toMatch(/synthetic/i);
      expect(inv.disclaimer).toBe(
        "Synthetic demo data. Decision support for human review; not a fire confirmation or emergency alert.",
      );
      expect(inv.status).toBe(s.expected.status);
      expect(inv.reviewPriority).toBe(s.expected.reviewPriority);
      expect(inv.evidenceStrength).toBe(s.expected.evidenceStrength);
      expect(inv.agentSteps.map((st) => st.agentId)).toEqual(["witness", "vision", "fusion"]);
      expect(inv.findings.every((f) => f.agentId !== "fusion")).toBe(true);
    });
  });

  it("contains no reporter ids, report ids, photo hashes or exact coordinates", async () => {
    const demo = await buildDemoInvestigations();
    const json = JSON.stringify(demo);
    expect(json).not.toMatch(/reporterId|syn-reporter-|photoSha256|syn-photo-|-report-\d/);
    demo.forEach((inv, i) => {
      const exact = RAW_SCENARIOS[i];
      expect(inv.approxLocation.precisionM).toBeGreaterThanOrEqual(DEMO_MIN_PUBLIC_PRECISION_M);
      const maxDecimals = decimalsForPrecision(inv.approxLocation.precisionM);
      expect(decimalsOf(inv.approxLocation.latitude)).toBeLessThanOrEqual(maxDecimals);
      expect(decimalsOf(inv.approxLocation.longitude)).toBeLessThanOrEqual(maxDecimals);
      // No exact report coordinate leaks anywhere in the output.
      for (const r of exact.witnessReports) {
        if (decimalsOf(r.latitude) > maxDecimals) expect(json).not.toContain(String(r.latitude));
        if (decimalsOf(r.longitude) > maxDecimals) expect(json).not.toContain(String(r.longitude));
      }
    });
  });

  it("is deterministic and JSON round-trips", async () => {
    const a = await buildDemoInvestigations();
    const b = await buildDemoInvestigations();
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("never claims a percentage or a confirmed fire", async () => {
    const json = JSON.stringify(await buildDemoInvestigations());
    expect(json).not.toMatch(/\d\s*%/);
    expect(json).not.toMatch(/confirmed fire|fire confirmed/i);
  });
});

describe("toApproxLocation", () => {
  it("rounds to at least 1 km and never returns -0", () => {
    expect(decimalsForPrecision(1000)).toBe(2);
    expect(decimalsForPrecision(10_000)).toBe(1);
    expect(toApproxLocation({ latitude: 53.41234, longitude: -1.78765, precisionM: 500 })).toEqual({
      latitude: 53.41,
      longitude: -1.79,
      precisionM: 1000,
    });
    const nearZero = toApproxLocation({ latitude: -0.001, longitude: 0.001, precisionM: 500 });
    expect(Object.is(nearZero.latitude, -0)).toBe(false);
    expect(DEMO_DISCLAIMER).toMatch(/^Synthetic demo data\./);
  });
});
