import Image from "next/image";

import { appLogoUrl } from "@/lib/app-branding";
import { cn } from "@/lib/utils";

export function AppLogoMark({ className }: { className?: string }) {
  return (
    <span className={cn("app-logo-mark", className)} aria-hidden="true">
      <Image src={appLogoUrl} alt="" width={48} height={48} unoptimized draggable={false} />
    </span>
  );
}
