"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

import { navigationItems } from "./navigation";
import { ThemeToggle } from "./ThemeToggle";

export function DesktopSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden min-h-screen w-72 border-r bg-card/80 px-4 py-5 md:flex md:flex-col">
      <Link href="/tracking-list" className="mb-8 flex items-center gap-3 px-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          A
        </div>
        <div>
          <p className="font-semibold tracking-tight">Ani Tracker</p>
        </div>
      </Link>

      <nav className="space-y-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                active && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-2xl border bg-background p-4">
        <p className="text-sm font-medium">桌面端</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          使用同一套路由、API 和类型定义，侧边栏仅负责桌面导航。
        </p>
        <div className="mt-3">
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
