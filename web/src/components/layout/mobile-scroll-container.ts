export const MOBILE_SCROLL_CONTAINER_ID = "app-mobile-scroll-container";

export function getMobileScrollContainer() {
  return document.getElementById(MOBILE_SCROLL_CONTAINER_ID);
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
