export const MOBILE_SCROLL_CONTAINER_ID = "app-mobile-scroll-container";

export function getMobileScrollContainer() {
  if (usesDocumentScrolling()) {
    return null;
  }

  return document.getElementById(MOBILE_SCROLL_CONTAINER_ID);
}

export function usesDocumentScrolling() {
  if (typeof window === "undefined") {
    return false;
  }

  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && navigator.standalone === true);
  const mobilePointer = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  return mobilePointer && !standalone;
}

export function subscribeToDocumentScrollMode(listener: () => void) {
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const pointerMode = window.matchMedia("(hover: none) and (pointer: coarse)");
  displayMode.addEventListener("change", listener);
  pointerMode.addEventListener("change", listener);
  return () => {
    displayMode.removeEventListener("change", listener);
    pointerMode.removeEventListener("change", listener);
  };
}

export function getPageScrollTop() {
  return getMobileScrollContainer()?.scrollTop ?? window.scrollY;
}

export function scrollPageTo(options: ScrollToOptions) {
  const container = getMobileScrollContainer();
  if (container) {
    container.scrollTo(options);
    return;
  }

  window.scrollTo(options);
}

export function addPageScrollListener(listener: () => void) {
  const container = getMobileScrollContainer();
  if (container) {
    container.addEventListener("scroll", listener, { passive: true });
    return () => container.removeEventListener("scroll", listener);
  }

  window.addEventListener("scroll", listener, { passive: true });
  return () => window.removeEventListener("scroll", listener);
}
