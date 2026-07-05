import { getRequestConfig } from "next-intl/server";

import { translations } from "@/i18n";

export default getRequestConfig(async () => ({
  locale: "zh-CN",
  messages: translations["zh-CN"],
}));
