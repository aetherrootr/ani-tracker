export default function TrackingListPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border bg-card p-5 md:p-8">
        <p className="text-sm font-medium text-muted-foreground">Tracking List</p>
        <div className="mt-3 max-w-3xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">Tracking List</h1>
          <p className="text-muted-foreground md:text-lg">
            记录正在追、想看和已完成的动画。这里先保留页面入口，具体列表能力后续独立设计。
          </p>
        </div>
      </section>

      <section className="rounded-3xl border border-dashed bg-card/50 p-8 text-muted-foreground">
        Tracking List 内容区域待实现。
      </section>
    </div>
  );
}
