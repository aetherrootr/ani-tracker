import { notFound } from "next/navigation";

import { AnimeDetailPageContent } from "@/components/library/AnimeDetailPageContent";

export default async function AnimeDetailPage({ params }: { params: Promise<{ animeId: string }> }) {
  const { animeId } = await params;
  const parsed = Number(animeId);

  if (!Number.isInteger(parsed) || parsed < 1) {
    notFound();
  }

  return <AnimeDetailPageContent animeId={parsed} />;
}
