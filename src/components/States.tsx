import type { ReactNode } from "react";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
      {label}...
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      <p>{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 rounded-lg border border-red-400 px-3 py-1 text-xs font-medium">Try again</button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
