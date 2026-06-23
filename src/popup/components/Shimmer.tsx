// Loading skeleton block (BRAND §7).
export function Shimmer({ className = '' }: { className?: string }) {
  return <div className={`shimmer rounded-lg ${className}`} />;
}

export function AssetRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-surface-container p-3">
      <Shimmer className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Shimmer className="h-4 w-20" />
        <Shimmer className="h-3 w-28" />
      </div>
      <Shimmer className="h-4 w-16" />
    </div>
  );
}
