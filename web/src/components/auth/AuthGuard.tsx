"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useCurrentUser } from "@/features/auth/hooks";

function GuardLoading() {
  const t = useTranslations();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-sm text-muted-foreground">
      {t("app.loadingAccount")}
    </div>
  );
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();

  useEffect(() => {
    if (!isLoading && user === null) {
      router.replace("/login");
    }
  }, [isLoading, router, user]);

  if (isLoading || user === null) {
    return <GuardLoading />;
  }

  return children;
}
