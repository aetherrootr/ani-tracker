import { ImageOff } from "lucide-react";
import { useTranslations } from "next-intl";

export function NoPoster() {
  const t = useTranslations();

  return (
    <div className="flex h-full min-h-32 w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
      <ImageOff className="h-7 w-7" />
      <span className="text-xs font-medium">{t("anime.noCover")}</span>
    </div>
  );
}
