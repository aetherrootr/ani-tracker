type EpisodeSummaryLabels = {
  single: (episode: number) => string;
  range: (start: number, end: number) => string;
  more: (range: string, count: number) => string;
  fallback: (count: number) => string;
};

const MAX_SUMMARY_CODE_POINTS = 32;

export function formatEpisodeSummary(
  episodeNumbers: number[],
  totalCount: number,
  labels: EpisodeSummaryLabels,
) {
  const sorted = [...new Set(episodeNumbers)].sort((left, right) => left - right);
  if (sorted.length === 0) return labels.fallback(totalCount);

  const start = sorted[0];
  let end = start;
  for (let index = 1; index < sorted.length && sorted[index] === end + 1; index += 1) {
    end = sorted[index];
  }
  const firstRangeLength = end - start + 1;
  const range = start === end ? labels.single(start) : labels.range(start, end);
  const remaining = Math.max(0, totalCount - firstRangeLength);
  const summary = remaining > 0 ? labels.more(range, remaining) : range;
  return Array.from(summary).length <= MAX_SUMMARY_CODE_POINTS
    ? summary
    : labels.fallback(totalCount);
}
