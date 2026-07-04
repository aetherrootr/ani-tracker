"use client";

import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SearchPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">搜索</h1>
        <p className="mt-2 text-muted-foreground">
          预留动画搜索入口；真实后端接入前不请求外部服务。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            搜索能力占位
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground">
            后续可以在这里接入 `/api/anime/search`，并复用 `Anime` 类型展示搜索结果。
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">同一 API client</Badge>
            <Badge variant="outline">同一类型定义</Badge>
            <Badge variant="outline">桌面/移动共用</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
