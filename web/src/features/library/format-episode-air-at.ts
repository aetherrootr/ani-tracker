export function formatEpisodeAirAt(value: string | null, precision: "date" | "datetime" | null, locale: string, fallback: string) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(precision === "datetime" ? { hour: "2-digit", minute: "2-digit" } : { timeZone: "UTC" }),
  }).format(date);
}
