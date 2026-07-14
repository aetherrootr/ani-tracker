"use client";

import { ArrowUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { addPageScrollListener, getPageScrollTop, scrollPageTo } from "./mobile-scroll-container";

export function BackToTopButton() {
  const t = useTranslations();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const isLibraryPage = pathname === "/library";

  useEffect(() => {
    function handleScroll() {
      setVisible(getPageScrollTop() > 360);
    }

    handleScroll();
    return addPageScrollListener(handleScroll);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <Button
      type="button"
      size="icon"
      className={isLibraryPage
        ? "fixed bottom-28 right-6 z-50 h-14 w-14 rounded-full shadow-lg sm:bottom-6 sm:h-10 sm:w-10"
        : "fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg sm:h-10 sm:w-10"}
      aria-label={t("search.backToTop")}
      onClick={() => scrollPageTo({ top: 0, behavior: "smooth" })}
    >
      <ArrowUp className="h-6 w-6 sm:h-4 sm:w-4" />
    </Button>
  );
}
