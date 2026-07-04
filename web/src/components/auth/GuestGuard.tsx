"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useCurrentUser } from "@/features/auth/hooks";

function GuardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-sm text-muted-foreground">
      正在加载账号状态...
    </div>
  );
}

export function GuestGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();

  useEffect(() => {
    if (!isLoading && user) {
      router.replace("/tracking-list");
    }
  }, [isLoading, router, user]);

  if (isLoading || user) {
    return <GuardLoading />;
  }

  return children;
}
