import type { Compensation, CompensationCurrency } from "./schema";

const monthlyMxnThreshold = 10000;
const yearlyMxnThreshold = monthlyMxnThreshold * 12;

export function normalizeCompensationCurrency(compensation: Compensation | undefined): Compensation | undefined {
  if (!compensation || compensation.currency) return compensation;

  const currency = inferCurrency(compensation);
  if (!currency) return compensation;
  return { ...compensation, currency };
}

function inferCurrency(compensation: Compensation): CompensationCurrency {
  const threshold = thresholdForPeriod(compensation.period);
  if (!threshold) return "";

  const values = [compensation.min, compensation.max]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return "";

  if (values.every((value) => value > threshold)) return "MXN";
  if (values.every((value) => value < threshold)) return "USD";
  return "";
}

function thresholdForPeriod(period: Compensation["period"]): number | undefined {
  if (period === "month") return monthlyMxnThreshold;
  if (period === "year") return yearlyMxnThreshold;
  return undefined;
}
