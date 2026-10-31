import { useEffect, useState, type ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { RangeSummary } from "@fittrack/shared";
import {
  calorieChartData, calorieSummaryText, hrData, hrSummaryText, macroData, macroSummaryText, netSummaryText, slotSummaryText, sourceData,
  sourceSummaryText, splitData, splitSummaryText, tickInterval, typeData, typeSummaryText, weightData, weightSummaryText, zoneData,
  zoneSummaryText, SLOT_LABEL, fmtInt, safe,
} from "./logic";

/** Okabe-Ito colour-blind-safe palette. */
const C = { blue: "#0072B2", orange: "#E69F00", green: "#009E73", red: "#D55E00", sky: "#56B4E9", pink: "#CC79A7", yellow: "#F0E442" };
const ZONE_COLORS = [C.sky, C.green, C.yellow, C.orange, C.red];

const tickStyle = { fontSize: 10, fill: "currentColor" } as const;
const tooltipStyle = { background: "rgba(255,255,255,0.97)", color: "#0f172a", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 12 } as const;
const H = 224;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

interface Table { headers: string[]; rows: Array<Array<string | number>> }

/** Card with a heading, a visible one-line text summary, the chart, and an expandable data table with the same numbers. */
function ChartCard({ chartId, title, summary, table, note, children }: { chartId?: string; title: string; summary: string; table: Table; note?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800" aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{summary}</p>
      {note && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{note}</p>}
      <div data-chart-id={chartId} className="mt-2 w-full min-w-0 text-slate-500 dark:text-slate-400" style={{ height: H }} role="img" aria-label={`${title}. ${summary}`}>
        {children}
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-teal-700 dark:text-teal-400">View data</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>{table.headers.map((h) => <th key={h} scope="col" className="sticky top-0 bg-white px-2 py-1 font-medium dark:bg-slate-800">{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-slate-700">
                  {r.map((c, j) => (j === 0 ? <th key={j} scope="row" className="px-2 py-1 font-normal">{c}</th> : <td key={j} className="px-2 py-1">{c}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Grid() {
  return <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.25} />;
}

const margin = { top: 5, right: 8, bottom: 0, left: -12 };

export function CaloriesChart({ s }: { s: RangeSummary }) {
  const anim = !useReducedMotion();
  const data = calorieChartData(s.days);
  const interval = tickInterval(data.length);
  return (
    <ChartCard
      chartId="inOut"
      title="Calories in vs out"
      summary={calorieSummaryText(s)}
      note="Calories out are estimated (BMR plus active calories). Hatched bars mark days with no meals logged."
      table={{
        headers: ["Date", "In (kcal)", "Out (kcal, estimated)"],
        rows: data.map((d) => [d.date, d.kcalIn == null ? "Not logged" : d.kcalIn, d.kcalOut]),
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={margin}>
          <defs>
            <pattern id="rp-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#94a3b8" fillOpacity={0.15} />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#94a3b8" strokeWidth="2" />
            </pattern>
          </defs>
          <Grid />
          <XAxis dataKey="label" tick={tickStyle} interval={interval} />
          <YAxis tick={tickStyle} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${fmtInt(v)} kcal`, n === "notLogged" ? "Not logged" : n]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="kcalIn" name="In" fill={C.blue} isAnimationActive={anim} />
          <Bar dataKey="kcalOut" name="Out (estimated)" fill={C.orange} isAnimationActive={anim} />
          <Bar dataKey="notLogged" name="Not logged" fill="url(#rp-hatch)" stroke="#94a3b8" legendType="rect" isAnimationActive={anim} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function NetChart({ s }: { s: RangeSummary }) {
  const anim = !useReducedMotion();
  const data = calorieChartData(s.days);
  return (
    <ChartCard
      chartId="net"
      title="Net balance"
      summary={netSummaryText(s)}
      note="Net = calories in minus calories out (estimated). Gaps are days with no meals logged."
      table={{ headers: ["Date", "Net (kcal, estimated)"], rows: data.map((d) => [d.date, d.net == null ? "Not logged" : d.net]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={margin}>
          <Grid />
          <XAxis dataKey="label" tick={tickStyle} interval={tickInterval(data.length)} />
          <YAxis tick={tickStyle} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${fmtInt(v)} kcal`, "Net (estimated)"]} />
          <ReferenceLine y={0} stroke="currentColor" strokeDasharray="4 2" label={{ value: "0", fontSize: 10, fill: "currentColor", position: "insideTopLeft" }} />
          <Line type="monotone" dataKey="net" name="Net (estimated)" stroke={C.blue} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={anim} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function SlotChart({ s }: { s: RangeSummary }) {
  const anim = !useReducedMotion();
  const data = s.slots.map((x) => ({ name: SLOT_LABEL[x.slot], avgKcal: Math.round(safe(x.avgKcal)), pct: Math.round(safe(x.pct)) }));
  return (
    <ChartCard
      chartId="slots"
      title="Calories per meal"
      summary={slotSummaryText(s)}
      table={{ headers: ["Meal", "Average kcal", "% of intake"], rows: data.map((d) => [d.name, d.avgKcal, `${d.pct}%`]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={margin}>
          <Grid />
          <XAxis dataKey="name" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${fmtInt(v)} kcal`, "Average"]} />
          <Bar dataKey="avgKcal" name="Average kcal" fill={C.green} isAnimationActive={anim} label={{ position: "top", fontSize: 10, fill: "currentColor" }} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function MacroChart({ s }: { s: RangeSummary }) {
  const anim = !useReducedMotion();
  const data = macroData(s);
  return (
    <ChartCard
      chartId="macros"
      title="Macros vs targets"
      summary={macroSummaryText(s)}
      table={{ headers: ["Macro", "Average (g)", "Target (g)", "% of target"], rows: data.map((d) => [d.name, d.avg, d.target, `${d.pct}%`]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={margin}>
          <Grid />
          <XAxis dataKey="name" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${v} g`, n]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="avg" name="Average" fill={C.blue} isAnimationActive={anim} />
          <Bar dataKey="target" name="Target" fill="#94a3b8" fillOpacity={0.6} isAnimationActive={anim} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Percent-of-target bars drawn as plain markup so the percentage is printed next to each bar. */
export function MacroPctBars({ s }: { s: RangeSummary }) {
  return (
    <ul className="space-y-2" aria-label="Macros as a percent of target">
      {macroData(s).map((d) => (
        <li key={d.name}>
          <div className="flex justify-between text-sm"><span>{d.name}</span><span className="font-medium">{d.pct}% of target</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuenow={Math.min(100, d.pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${d.name} percent of target`}>
            <div className="h-full bg-sky-600" style={{ width: `${Math.min(100, Math.max(0, d.pct))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SplitChart({ s }: { s: RangeSummary }) {
  const anim = !useReducedMotion();
  const data = splitData(s);
  const colors = [C.blue, C.orange, C.pink];
  return (
    <ChartCard
      title="Where calories come from"
      summary={splitSummaryText(s)}
      table={{ headers: ["Macro", "% of calories"], rows: data.map((d) => [d.name, `${Math.round(d.value)}%`]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${Math.round(v)}%`, n]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2} isAnimationActive={anim}
            label={({ name, value }: { name?: string; value?: number }) => `${name ?? ""} ${Math.round(value ?? 0)}%`} labelLine={false} stroke="none">
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length] ?? C.blue} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function WeightChart({ s }: { s: RangeSummary }) {
  const anim = !useReducedMotion();
  const data = weightData(s);
  return (
    <ChartCard
      chartId="weight"
      title="Weight and BMI"
      summary={weightSummaryText(s)}
      table={{ headers: ["Date", "Weight (kg)", "BMI"], rows: data.map((d) => [d.date, d.weightKg, d.bmi]) }}
    >
      {data.length < 2 ? (
        <p className="py-10 text-center text-sm">Log at least two weights in this range to see a trend.</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 0, bottom: 0, left: -12 }}>
            <Grid />
            <XAxis dataKey="label" tick={tickStyle} interval={tickInterval(data.length)} />
            <YAxis yAxisId="w" domain={["dataMin - 1", "dataMax + 1"]} tick={tickStyle} tickFormatter={(n: number) => n.toFixed(0)} />
            <YAxis yAxisId="b" orientation="right" domain={["dataMin - 1", "dataMax + 1"]} tick={tickStyle} tickFormatter={(n: number) => n.toFixed(0)} width={28} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line yAxisId="w" type="monotone" dataKey="weightKg" name="Weight (kg)" stroke={C.blue} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={anim} />
            <Line yAxisId="b" type="monotone" dataKey="bmi" name="BMI" stroke={C.red} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3, strokeWidth: 1 }} isAnimationActive={anim} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function TypeChart({ s }: { s: RangeSummary }) {
  const anim = !useReducedMotion();
  const data = typeData(s);
  return (
    <ChartCard
      title="Activity by type"
      summary={typeSummaryText(s)}
      note={s.activity.activeKcal > 0 ? `Active calories ${fmtInt(s.activity.activeKcal)} kcal; ${Math.round(safe(s.activity.estimatedShare) * 100)}% of them are MET-based estimates.` : undefined}
      table={{ headers: ["Type", "Activities", "Minutes", "kcal"], rows: data.map((d) => [d.name, d.count, d.minutes, d.kcal]) }}
    >
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm">No activities in this range.</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={margin}>
            <Grid />
            <XAxis dataKey="name" tick={tickStyle} interval={0} />
            <YAxis yAxisId="c" allowDecimals={false} tick={tickStyle} />
            <YAxis yAxisId="m" orientation="right" tick={tickStyle} width={32} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="c" dataKey="count" name="Activities" fill={C.blue} isAnimationActive={anim} />
            <Bar yAxisId="m" dataKey="minutes" name="Minutes" fill={C.orange} isAnimationActive={anim} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function SourceChart({ s }: { s: RangeSummary }) {
  const anim = !useReducedMotion();
  const data = sourceData(s);
  return (
    <ChartCard
      title="Strava vs manual"
      summary={sourceSummaryText(s)}
      table={{ headers: ["Source", "Activities", "Minutes"], rows: data.map((d) => [d.name, d.count, d.minutes]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={margin}>
          <Grid />
          <XAxis dataKey="name" tick={tickStyle} />
          <YAxis allowDecimals={false} tick={tickStyle} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="count" name="Activities" fill={C.blue} isAnimationActive={anim} label={{ position: "top", fontSize: 10, fill: "currentColor" }} />
          <Bar dataKey="minutes" name="Minutes" fill={C.orange} isAnimationActive={anim} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function HrChart({ s }: { s: RangeSummary }) {
  const anim = !useReducedMotion();
  const data = hrData(s);
  return (
    <ChartCard
      chartId="hr"
      title="Heart rate"
      summary={hrSummaryText(s)}
      table={{ headers: ["Date", "Average (bpm)", "Max (bpm)"], rows: data.map((d) => [d.date, d.avgHr ?? "none", d.maxHr ?? "none"]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={margin}>
          <Grid />
          <XAxis dataKey="label" tick={tickStyle} interval={tickInterval(data.length)} />
          <YAxis domain={["dataMin - 5", "dataMax + 5"]} tick={tickStyle} tickFormatter={(n: number) => n.toFixed(0)} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [`${v} bpm`, n]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="avgHr" name="Average" stroke={C.blue} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={anim} />
          <Line type="monotone" dataKey="maxHr" name="Max" stroke={C.red} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} connectNulls isAnimationActive={anim} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ZoneChart({ s }: { s: RangeSummary }) {
  const anim = !useReducedMotion();
  const data = zoneData(s);
  return (
    <ChartCard
      title="Time in heart-rate zones"
      summary={zoneSummaryText(s)}
      table={{ headers: ["Zone", "Minutes", "% of time"], rows: data.map((d) => [d.name, d.minutes, `${d.pct}%`]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={margin}>
          <Grid />
          <XAxis dataKey="name" tick={tickStyle} />
          <YAxis tick={tickStyle} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} min`, "Time"]} />
          <Bar dataKey="minutes" name="Minutes" isAnimationActive={anim} label={{ position: "top", fontSize: 10, fill: "currentColor" }}>
            {data.map((_, i) => <Cell key={i} fill={ZONE_COLORS[i] ?? C.blue} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
