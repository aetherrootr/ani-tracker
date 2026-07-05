import { en } from "./en";
import { zhCN, type TranslationKey } from "./zh-CN";

export const translations = {
  "zh-CN": zhCN,
  en,
} as const;

export type Locale = keyof typeof translations;
export type { TranslationKey };
