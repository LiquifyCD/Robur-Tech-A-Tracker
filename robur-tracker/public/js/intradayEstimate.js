export function deriveIntradayEstimate(summary, officialNavChangePct) {
  const coveragePct = Number.isFinite(summary?.calculatedCoveragePct)
    ? summary.calculatedCoveragePct
    : 0;
  const hasEstimate = Number(summary?.availableCount) > 0 && Number.isFinite(summary?.netPctPoints);
  return {
    officialNavChangePct: Number.isFinite(officialNavChangePct) ? officialNavChangePct : null,
    estimatedChangePct: hasEstimate ? summary.netPctPoints : null,
    coveragePct,
    hasEstimate,
    isPartial: hasEstimate && (summary?.isPartial ?? coveragePct < 99.5),
    scaledToFullPortfolio: false,
  };
}
