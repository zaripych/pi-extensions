/**
 * Cost Tracker Extension for pi
 *
 * Summarizes LLM API costs across all pi sessions by reading pi's own
 * session files (JSONL files under ~/.pi/agent/sessions).
 *
 * - Provides /cost command for daily totals and model breakdowns
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { collectSessionCostRecords } from "./collectSessionCostRecords";

// ── Types ────────────────────────────────────────────────────────────────────

type CostRecord = Awaited<ReturnType<typeof collectSessionCostRecords>>["records"][number];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return { year, month, day } strings for a Date in local time. */
function dateParts(d: Date): { year: string; month: string; day: string } {
	return {
		year: String(d.getFullYear()),
		month: String(d.getMonth() + 1).padStart(2, "0"),
		day: String(d.getDate()).padStart(2, "0"),
	};
}

/** Format a date as YYYY-MM-DD. */
function fmtDate(d: Date): string {
	const { year, month, day } = dateParts(d);
	return `${year}-${month}-${day}`;
}

/** Enumerate dates from `start` to `end` inclusive (local time, day precision). */
function dateRange(start: Date, end: Date): Date[] {
	const dates: Date[] = [];
	const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
	const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
	while (cur <= last) {
		dates.push(new Date(cur));
		cur.setDate(cur.getDate() + 1);
	}
	return dates;
}

/** Sum record cost per local date (YYYY-MM-DD). */
function totalsByDay(records: CostRecord[]): Map<string, number> {
	const totals = new Map<string, number>();
	for (const r of records) {
		const key = fmtDate(new Date(r.ts));
		totals.set(key, (totals.get(key) ?? 0) + r.cost.total);
	}
	return totals;
}

/** Group records by key, sorted by total cost descending. */
function tally(records: CostRecord[], keyOf: (r: CostRecord) => string) {
	const map = new Map<string, { total: number; tokens: number; calls: number; cwd: string }>();
	for (const r of records) {
		const key = keyOf(r);
		const existing = map.get(key) ?? { total: 0, tokens: 0, calls: 0, cwd: r.cwd };
		existing.total += r.cost.total;
		existing.tokens += r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite;
		existing.calls += 1;
		map.set(key, existing);
	}
	return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
}

/** Format dollars with appropriate precision. */
function fmtCost(n: number): string {
	if (n === 0) return "$0.00";
	if (n < 0.01) return `$${n.toFixed(4)}`;
	return `$${n.toFixed(2)}`;
}

/** Format token count with K/M suffix. */
function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

/** Shorten a project path for display: home prefix becomes ~. */
function fmtProject(cwd: string): string {
	return cwd.startsWith(homedir()) ? `~${cwd.slice(homedir().length)}` : cwd;
}

/** Parse a duration argument like "7d" or "30d". Returns number of days or null. */
function parseDuration(arg: string): number | null {
	const match = arg.trim().match(/^(\d+)d$/i);
	if (!match || match[1] === undefined) return null;
	return parseInt(match[1], 10);
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── /cost command ────────────────────────────────────────────────────────

	pi.registerCommand("cost", {
		description: "Show API cost summary. Usage: /cost [Nd] — e.g. /cost, /cost 7d, /cost 30d",
		handler: async (args, ctx) => {
			const theme = ctx.ui.theme;
			const today = new Date();
			let days = 1; // default: today only

			if (args && args.trim().length > 0) {
				const parsed = parseDuration(args);
				if (parsed === null || parsed < 1) {
					ctx.ui.notify("Usage: /cost [Nd] — e.g. /cost, /cost 7d, /cost 30d", "warning");
					return;
				}
				days = parsed;
			}

			// Build date range
			const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));

			// Read all records in range from pi session files
			const { records, stats } = await collectSessionCostRecords({ start, end: today });

			// Build output
			const lines: string[] = [];

			const pushSection = (title: string, rows: { label: string; total: number; suffix: string }[]) => {
				if (rows.length === 0) return;
				lines.push("");
				lines.push(theme.fg("accent", `  ${title}`));
				lines.push(theme.fg("dim", "  ─".padEnd(60, "─")));
				for (const row of rows) {
					lines.push(
						`  ${theme.fg("dim", row.label.padEnd(45))} ${theme.bold(fmtCost(row.total).padStart(8))}  ${theme.fg("dim", row.suffix)}`,
					);
				}
			};

			if (days === 1) {
				lines.push(theme.bold(theme.fg("accent", `Cost for ${fmtDate(today)}`)));
			} else {
				lines.push(theme.bold(theme.fg("accent", `Cost for last ${days} days (${fmtDate(start)} → ${fmtDate(today)})`)));
			}
			lines.push("");

			// Grand total
			const grandTotal = records.reduce((sum, r) => sum + r.cost.total, 0);
			const grandTokens = records.reduce(
				(sum, r) => sum + r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite,
				0,
			);
			const grandCalls = records.length;
			lines.push(
				`  ${theme.fg("success", "Total")}: ${theme.bold(fmtCost(grandTotal))}  ${theme.fg("dim", `${fmtTokens(grandTokens)} tokens · ${grandCalls} calls`)}`,
			);

			// Per-day breakdown (only if multi-day)
			if (days > 1) {
				const totals = totalsByDay(records);
				lines.push("");
				lines.push(theme.fg("accent", "  Daily breakdown"));
				lines.push(theme.fg("dim", "  ─".padEnd(60, "─")));
				for (const d of dateRange(start, today)) {
					const key = fmtDate(d);
					const total = totals.get(key);
					lines.push(
						total === undefined
							? `  ${theme.fg("dim", key)}  ${theme.fg("dim", "—")}`
							: `  ${theme.fg("dim", key)}  ${theme.bold(fmtCost(total))}`,
					);
				}
			}

			pushSection(
				"By model",
				tally(records, (r) => `${r.provider}/${r.model}`).map(([model, data]) => ({
					label: model,
					total: data.total,
					suffix: `${fmtTokens(data.tokens)} tok · ${data.calls} calls`,
				})),
			);

			pushSection(
				"By project",
				tally(records, (r) => r.cwd).map(([cwd, data]) => ({
					label: fmtProject(cwd),
					total: data.total,
					suffix: `${data.calls} calls`,
				})),
			);

			const bySession = tally(records, (r) => r.sessionId);
			pushSection(
				`Top sessions (${Math.min(10, bySession.length)} of ${bySession.length})`,
				bySession.slice(0, 10).map(([sessionId, data]) => ({
					label: `${sessionId.slice(0, 8)} · ${fmtProject(data.cwd)}`,
					total: data.total,
					suffix: `${data.calls} calls`,
				})),
			);

			if (records.length === 0) {
				lines.push(theme.fg("dim", "  No cost data recorded for this period."));
			}

			if (stats.invalidJsonLines > 0 || stats.schemaMismatchLines > 0) {
				lines.push(
					theme.fg(
						"dim",
						`  Skipped session lines: ${stats.invalidJsonLines} invalid JSON · ${stats.schemaMismatchLines} schema mismatch`,
					),
				);
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
