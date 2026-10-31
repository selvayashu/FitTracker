import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { deterministicActivityId, hrZoneSecondsForWorkout } from "@fittrack/shared";
import { Sheet } from "@/components/Sheet";
import { Spinner } from "@/components/States";
import { useProfile } from "@/lib/profile";
import { useSession } from "@/lib/session";
import { formatIst } from "@/lib/time";
import { Banner, inputCls, primaryBtn, secondaryBtn } from "@/features/profile/ui";
import { loadActivities, useActivityStore } from "../store";
import { fetchExisting, fetchExistingIds, fetchTypes, runImport, type ImportEntry } from "./api";
import {
  NO_WEIGHT_NOTE, OFFLINE_MESSAGE, SECURE_CONTEXT_MESSAGE, canHash, computeIds, assembleRow, decideStatus, defaultTypeChoice, existingWindow, formatMinutes, importButtonLabel,
  isOtherType, maxHrFor, needsTzChoice, parseTexts, selectionProblem, similarCount, summaryText, validateFiles, validateParsedWorkout,
  type ExistingActivity, type FileText, type ImportOutcome, type RejectedFile, type TypeChoice,
} from "./logic";
import type { ActivityTypeRow } from "@/lib/database.types";

const ACCEPT = ".gpx,.tcx,application/gpx+xml,application/xml,text/xml";

const CHIP: Record<string, string> = {
  ready: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100",
  imported: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  similar: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  blocked: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
};

const CHIP_TEXT: Record<string, string> = { ready: "Ready", imported: "Already imported", similar: "Possible duplicate", blocked: "Can't import" };

interface Result { outcome: ImportOutcome; zoneFailures: string[]; noWeight: boolean }

/** Sheet to import workouts from GPX/TCX files. Files are read and parsed on this device only. */
export function ImportSheet({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const { profile } = useProfile();
  const { types: cachedTypes } = useActivityStore();
  const [texts, setTexts] = useState<FileText[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [reading, setReading] = useState(false);
  const [assumeIst, setAssumeIst] = useState(false);
  const [types, setTypes] = useState<ActivityTypeRow[]>(cachedTypes);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [ids, setIds] = useState<Record<string, string> | null>(null);
  const [lookup, setLookup] = useState<{ existing: ExistingActivity[]; idSet: Set<string> } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, TypeChoice>>({});
  const [checkedOv, setCheckedOv] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseTexts(texts, assumeIst ? "ist" : "utc"), [texts, assumeIst]);
  const items = parsed.items;

  // Activity types: use the cached list, else query once files are parsed.
  useEffect(() => {
    if (items.length === 0 || types.length > 0) return;
    let live = true;
    fetchTypes().then((t) => { if (live) { setTypes(t); setTypesError(null); } })
      .catch((e: unknown) => { if (live) setTypesError(e instanceof Error ? e.message : "Could not load activity types."); });
    return () => { live = false; };
  }, [items.length, types.length]);

  // Deterministic ids, then existing activities and ids for duplicate detection.
  useEffect(() => {
    setIds(null); setLookup(null); setLookupError(null);
    if (!userId || items.length === 0) return;
    let live = true;
    (async () => {
      try {
        if (!canHash()) { if (live) setLookupError(SECURE_CONTEXT_MESSAGE); return; }
        const idMap = await computeIds(items, (w) => deterministicActivityId(userId, w));
        const entries = Object.entries(idMap);
        const win = existingWindow(items);
        const [existing, idSet] = await Promise.all([
          win ? fetchExisting(userId, win.fromIso, win.toIso) : Promise.resolve([]),
          fetchExistingIds(entries.map((e) => e[1])),
        ]);
        if (live) { setIds(idMap); setLookup({ existing, idSet }); }
      } catch {
        if (live) setLookupError("lookup");
      }
    })();
    return () => { live = false; };
  }, [items, userId]);

  const maxHr = maxHrFor(profile);
  const ready = ids !== null && lookup !== null && types.length > 0;

  const rows = useMemo(() => items.map((item) => {
    const choice = choices[item.key] ?? defaultTypeChoice(item.workout, types);
    const id = ids?.[item.key] ?? null;
    if (ready && choice && !id) {
      return { item, choice, id, status: decideStatus({ problems: ["could not identify this workout"], idExists: false, similarCount: 0 }), checked: false };
    }
    if (!ready || !choice || !id || !lookup) return { item, choice, id, status: null, checked: false };
    const problems = [...validateParsedWorkout(item.workout)];
    const sel = selectionProblem(choice, types);
    if (sel) problems.push(sel);
    const status = decideStatus({
      problems, idExists: lookup.idSet.has(id), similarCount: similarCount(id, choice.typeId, item.workout.startTime, lookup.existing),
    });
    const checked = status.selectable && (checkedOv[item.key] ?? status.defaultChecked);
    return { item, choice, id, status, checked };
  }), [items, choices, ids, lookup, types, ready, checkedOv]);

  const selected = rows.filter((r) => r.checked);

  const addFiles = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setResult(null); setFormError(null);
    const { accepted, rejected: rej } = validateFiles(files, texts.length);
    setRejected(rej);
    if (accepted.length === 0) return;
    setReading(true);
    const read: FileText[] = [];
    const failed: RejectedFile[] = [...rej];
    for (const f of accepted) {
      try { read.push({ name: f.name, text: await f.text() }); } catch { failed.push({ name: f.name, reason: "The file could not be read." }); }
    }
    setRejected(failed);
    setTexts((prev) => [...prev, ...read]);
    setCheckedOv({});
    setReading(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); void addFiles(e.dataTransfer.files); };

  const clearAll = () => { setTexts([]); setRejected([]); setChoices({}); setCheckedOv({}); setResult(null); setFormError(null); setAssumeIst(false); };

  const doImport = async () => {
    setFormError(null);
    if (!navigator.onLine) { setFormError(OFFLINE_MESSAGE); return; }
    if (!userId || selected.length === 0) return;
    setImporting(true);
    const entries: ImportEntry[] = [];
    for (const r of selected) {
      if (!r.id || !r.choice) continue;
      const w = r.item.workout;
      const zones = maxHr !== null ? hrZoneSecondsForWorkout(w, maxHr) : null;
      entries.push({
        label: `${r.item.fileName} (${formatIst(w.startTime)})`,
        row: assembleRow(w, r.choice, { userId, id: r.id, fileName: r.item.fileName, weightKg: profile?.weight_kg ?? null, maxHr, types }),
        zones, maxHrUsed: maxHr,
      });
    }
    try {
      const { outcome, zoneFailures } = await runImport(entries);
      const full: ImportOutcome = { ...outcome, skipped: rows.length - entries.length };
      setResult({ outcome: full, zoneFailures, noWeight: !profile?.weight_kg && entries.some((e) => e.row.calories === null) });
      if (outcome.imported > 0) {
        const done = new Set(entries.map((e) => e.row.id));
        const from = entries.reduce((m, e) => (e.row.start_time < m ? e.row.start_time : m), entries[0].row.start_time);
        try { await loadActivities(userId, from, false); } catch { /* the Activity page refreshes on its own */ }
        onImported?.();
        // Imported rows now exist; clear selection and re-check statuses.
        setCheckedOv({});
        setLookup((l) => (l ? { ...l, idSet: new Set([...l.idSet, ...done]) } : l));
      }
    } catch (e) {
      setFormError(e instanceof Error ? `Import failed: ${e.message}` : "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Sheet title="Import activity file" onClose={onClose}>
      <div className="min-w-0 space-y-3">
        <p className="rounded-lg bg-slate-100 p-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          Your file is read on this device. It is not uploaded. Location data is not stored.
        </p>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
          className={`rounded-xl border-2 border-dashed p-4 text-center ${dragging ? "border-teal-600 bg-teal-50 dark:bg-teal-950" : "border-slate-300 dark:border-slate-600"}`}
        >
          <label htmlFor="import-files" className="block text-sm font-medium">Choose GPX or TCX files</label>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Up to 20 files, 10 MB each. You can also drop files here.</p>
          <input
            id="import-files" ref={fileInput} type="file" accept={ACCEPT} multiple disabled={reading || importing}
            onChange={(e) => void addFiles(e.target.files)} className="mt-2 block w-full min-w-0 text-sm"
          />
        </div>

        {reading && <Spinner label="Reading files" />}
        {rejected.map((r) => <Banner key={`${r.name}-${r.reason}`} kind="error">{r.name}: {r.reason}</Banner>)}
        {parsed.errors.map((e) => <Banner key={e.fileName} kind="error">{e.fileName}: {e.message}</Banner>)}
        {typesError && <Banner kind="error">Could not load activity types: {typesError}</Banner>}
        {lookupError && <Banner kind="error">{lookupError === SECURE_CONTEXT_MESSAGE ? lookupError : "Could not check your existing activities. Check your connection and try again."}</Banner>}

        {texts.length === 0 && !reading && (
          <p className="text-center text-sm text-slate-500 dark:text-slate-400">No files chosen yet.</p>
        )}

        {needsTzChoice(items) && (
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700">
            <input type="checkbox" className="mt-1" checked={assumeIst} onChange={(e) => { setAssumeIst(e.target.checked); setCheckedOv({}); setResult(null); }} />
            <span>These files use India time (IST), not UTC<br />
              <span className="text-xs text-slate-500 dark:text-slate-400">Some times in your files have no time zone. Tick this if they are local India times.</span>
            </span>
          </label>
        )}

        {items.length > 0 && !ready && !lookupError && <Spinner label="Checking for duplicates" />}

        <ul className="space-y-2" aria-label="Workouts found">
          {rows.map(({ item, choice, status, checked }, idx) => {
            const w = item.workout;
            const other = choice ? isOtherType(choice.typeId, types) : false;
            const estimated = w.calories === null || w.calories <= 0;
            const hasHr = !!w.hr && w.hr.heartrate.length > 0;
            return (
              <li key={item.key} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex min-w-0 items-start gap-2">
                  <input
                    type="checkbox" className="mt-1 h-5 w-5 shrink-0" aria-label={`Import workout ${idx + 1} from ${item.fileName}`}
                    checked={checked} disabled={!status?.selectable || importing}
                    onChange={(e) => setCheckedOv((o) => ({ ...o, [item.key]: e.target.checked }))}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{w.name ?? item.fileName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{formatIst(w.startTime)} IST</p>
                  </div>
                  {status && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${CHIP[status.kind]}`}>{CHIP_TEXT[status.kind]}</span>}
                </div>
                {status && (status.kind === "blocked" || status.kind === "similar") && (
                  <p className="text-xs text-slate-600 dark:text-slate-300">{status.label}</p>
                )}
                {choice && (
                  <div className="grid grid-cols-1 gap-2">
                    <select
                      className={inputCls} aria-label={`Activity type for workout ${idx + 1}`} value={choice.typeId} disabled={importing}
                      onChange={(e) => {
                        const typeId = Number(e.target.value);
                        setChoices((c) => ({ ...c, [item.key]: { typeId, custom: isOtherType(typeId, types) ? choice.custom || defaultTypeChoice(w, types)?.custom || "Workout" : "" } }));
                      }}
                    >
                      {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    {other && (
                      <input
                        className={inputCls} aria-label={`Custom name for workout ${idx + 1}`} placeholder="Activity name" maxLength={80}
                        value={choice.custom} disabled={importing}
                        onChange={(e) => setChoices((c) => ({ ...c, [item.key]: { typeId: choice.typeId, custom: e.target.value } }))}
                      />
                    )}
                  </div>
                )}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-slate-500 dark:text-slate-400">Duration</dt><dd>{formatMinutes(w.movingSec ?? w.elapsedSec)}</dd>
                  <dt className="text-slate-500 dark:text-slate-400">Distance</dt><dd>{w.distanceKm !== null ? `${w.distanceKm.toFixed(2)} km` : "n/a"}</dd>
                  <dt className="text-slate-500 dark:text-slate-400">Heart rate</dt>
                  <dd>{w.avgHr !== null || w.maxHr !== null ? `${w.avgHr !== null ? Math.round(w.avgHr) : "?"} avg / ${w.maxHr !== null ? Math.round(w.maxHr) : "?"} max bpm` : "n/a"}</dd>
                  <dt className="text-slate-500 dark:text-slate-400">Calories</dt>
                  <dd>{w.calories !== null && w.calories > 0 ? `${Math.round(w.calories)} kcal` : profile?.weight_kg ? "estimated" : "not available"}
                    {estimated && profile?.weight_kg ? <span className="ml-1 rounded bg-slate-200 px-1 dark:bg-slate-700">estimated</span> : null}</dd>
                </dl>
                {hasHr && <span className="inline-block rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-800 dark:bg-rose-900 dark:text-rose-100">HR zones included</span>}
                {w.warnings.map((m) => <p key={m} className="text-xs text-amber-700 dark:text-amber-300">{m}</p>)}
              </li>
            );
          })}
        </ul>

        {formError && <Banner kind="error">{formError}</Banner>}

        {result && (
          <div role="status" className="space-y-2">
            <Banner kind={result.outcome.failed.length > 0 ? "error" : "success"}>{summaryText(result.outcome)}</Banner>
            {result.outcome.failed.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-red-700 dark:text-red-300">
                {result.outcome.failed.map((f) => <li key={f.label}>{f.label}: {f.reason}</li>)}
              </ul>
            )}
            {result.zoneFailures.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-amber-700 dark:text-amber-300">
                {result.zoneFailures.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
            {result.noWeight && <p className="text-xs text-slate-600 dark:text-slate-300">{NO_WEIGHT_NOTE}</p>}
          </div>
        )}

        {items.length > 0 && (
          <div className="flex gap-2">
            <button type="button" className={`${primaryBtn} flex-1`} disabled={importing || reading || selected.length === 0} onClick={() => void doImport()}>
              {importing ? "Importing..." : selected.length === 0 ? "Nothing selected" : importButtonLabel(selected.length)}
            </button>
            <button type="button" className={secondaryBtn} disabled={importing} onClick={clearAll}>Clear</button>
          </div>
        )}
        {!navigator.onLine && <p className="text-xs text-amber-700 dark:text-amber-300">{OFFLINE_MESSAGE}</p>}
        {profile && !profile.weight_kg && items.length > 0 && !result && <p className="text-xs text-slate-500 dark:text-slate-400">{NO_WEIGHT_NOTE}</p>}
      </div>
    </Sheet>
  );
}
