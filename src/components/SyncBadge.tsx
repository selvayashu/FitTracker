import { useEffect, useState } from "react";
import { clearFailed, flush, getOutboxState, subscribeOutbox, type OutboxState } from "@/lib/outbox";

/** Shows offline / pending-sync / failed state of the write queue. Renders nothing when everything is synced. */
export function SyncBadge() {
  const [s, setS] = useState<OutboxState>(getOutboxState());
  useEffect(() => subscribeOutbox(setS), []);

  if (s.online && s.pending === 0 && s.failed === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 bg-amber-100 px-3 py-1 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
      <span>
        {!s.online ? "Offline: changes are saved on this device. " : ""}
        {s.pending > 0 ? `${s.pending} waiting to sync. ` : ""}
        {s.failed > 0 ? `${s.failed} could not be saved.` : ""}
      </span>
      <span className="flex gap-2">
        {s.online && s.pending > 0 && <button className="underline" onClick={() => void flush()}>Sync now</button>}
        {s.failed > 0 && <button className="underline" onClick={() => void clearFailed()}>Dismiss</button>}
      </span>
    </div>
  );
}
