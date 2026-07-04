import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">设置</h1>
        <p className="mt-2 text-muted-foreground">预留页面，后续可加入同步源、主题和账号设置。</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>后端接入</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-6 text-muted-foreground">
          当前前端不接真实服务。后续接入方式会在相关页面和数据结构确定后再设计。
        </CardContent>
      </Card>
    </div>
  );
}
