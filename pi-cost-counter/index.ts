/**
 * Cost Tracker Extension for pi
 *
 * Tracks LLM API costs across all pi sessions. Writes append-only JSONL records
 * organised by year/month/day for safe concurrent access from multiple pi clients.
 *
 * - Captures cost data from every assistant message (message_end event)
 * - Displays running session cost in the footer status bar
 * - Provides /cost command for daily totals and model breakdowns
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────────────────────────

interface CostRecord {
	ts: number;
	provider: string;
	model: string;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

interface AggregatedDay {
	date: string;
	total: number;
	byModel: Map<string, { total: number; tokens: number; calls: number }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_DIR = join(homedir(), ".pi", "cost-tracker");

/** Return { year, month, day } strings for a Date in local time. */
function dateParts(d: Date): { year: string; month: string; day: string } {
	return {
		year: String(d.getFullYear()),
		month: String(d.getMonth() + 1).padStart(2, "0"),
		day: String(d.getDate()).padStart(2, "0"),
	};
}

/** Absolute path to the JSONL file for a given date. */
function dayFilePath(d: Date): string {
	const { year, month, day } = dateParts(d);
	return join(BASE_DIR, year, month, `${day}.jsonl`);
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

/** Read and parse all records from a day file. Returns [] if file doesn't exist. */
async function readDayFile(path: string): Promise<CostRecord[]> {
	if (!existsSync(path)) return [];
	try {
		const raw = await readFile(path, "utf8");
		return raw
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => JSON.parse(line) as CostRecord);
	} catch {
		return [];
	}
}

/** Aggregate records into per-day summaries. */
function aggregate(records: CostRecord[], dates: Date[]): AggregatedDay[] {
	// Group records by local date string
	const byDate = new Map<string, CostRecord[]>();
	for (const d of dates) {
		byDate.set(fmtDate(d), []);
	}
	for (const r of records) {
		const key = fmtDate(new Date(r.ts));
		const list = byDate.get(key);
		if (list) list.push(r);
	}

	const days: AggregatedDay[] = [];
	for (const d of dates) {
		const key = fmtDate(d);
		const recs = byDate.get(key) ?? [];
		const byModel = new Map<string, { total: number; tokens: number; calls: number }>();
		let total = 0;
		for (const r of recs) {
			total += r.cost.total;
			const modelKey = `${r.provider}/${r.model}`;
			const existing = byModel.get(modelKey) ?? { total: 0, tokens: 0, calls: 0 };
			existing.total += r.cost.total;
			existing.tokens += r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite;
			existing.calls += 1;
			byModel.set(modelKey, existing);
		}
		days.push({ date: key, total, byModel });
	}
	return days;
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

/** Parse a duration argument like "7d" or "30d". Returns number of days or null. */
function parseDuration(arg: string): number | null {
	const match = arg.trim().match(/^(\d+)d$/i);
	if (!match || match[1] === undefined) return null;
	return parseInt(match[1], 10);
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── Append cost record on every assistant message ────────────────────────

	pi.on("message_end", async (event, _ctx) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;

		const usage = (msg as any).usage;
		if (!usage?.cost) return;

		const record: CostRecord = {
			ts: Date.now(),
			provider: (msg as any).provider ?? "unknown",
			model: (msg as any).model ?? "unknown",
			tokens: {
				input: usage.input ?? 0,
				output: usage.output ?? 0,
				cacheRead: usage.cacheRead ?? 0,
				cacheWrite: usage.cacheWrite ?? 0,
			},
			cost: {
				input: usage.cost.input ?? 0,
				output: usage.cost.output ?? 0,
				cacheRead: usage.cost.cacheRead ?? 0,
				cacheWrite: usage.cost.cacheWrite ?? 0,
				total: usage.cost.total ?? 0,
			},
		};

		// Persist record
		const filePath = dayFilePath(new Date());
		const dir = join(filePath, "..");
		await mkdir(dir, { recursive: true });
		await appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
	});

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
			const dates = dateRange(start, today);

			// Read all records in range
			const allRecords: CostRecord[] = [];
			for (const d of dates) {
				const recs = await readDayFile(dayFilePath(d));
				allRecords.push(...recs);
			}

			const aggregated = aggregate(allRecords, dates);

			// Build output
			const lines: string[] = [];

			if (days === 1) {
				lines.push(theme.bold(theme.fg("accent", `Cost for ${fmtDate(today)}`)));
			} else {
				lines.push(theme.bold(theme.fg("accent", `Cost for last ${days} days (${fmtDate(start)} → ${fmtDate(today)})`)));
			}
			lines.push("");

			// Grand total
			const grandTotal = allRecords.reduce((sum, r) => sum + r.cost.total, 0);
			const grandTokens = allRecords.reduce(
				(sum, r) => sum + r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite,
				0,
			);
			const grandCalls = allRecords.length;
			lines.push(
				`  ${theme.fg("success", "Total")}: ${theme.bold(fmtCost(grandTotal))}  ${theme.fg("dim", `${fmtTokens(grandTokens)} tokens · ${grandCalls} calls`)}`,
			);
			lines.push("");

			// Per-day breakdown (only if multi-day)
			if (days > 1) {
				lines.push(theme.fg("accent", "  Daily breakdown"));
				lines.push(theme.fg("dim", "  ─".padEnd(60, "─")));
				for (const day of aggregated) {
					if (day.total === 0 && day.byModel.size === 0) {
						lines.push(`  ${theme.fg("dim", day.date)}  ${theme.fg("dim", "—")}`);
					} else {
						lines.push(`  ${theme.fg("dim", day.date)}  ${theme.bold(fmtCost(day.total))}`);
					}
				}
				lines.push("");
			}

			// Model breakdown (across entire range)
			const globalByModel = new Map<string, { total: number; tokens: number; calls: number }>();
			for (const r of allRecords) {
				const key = `${r.provider}/${r.model}`;
				const existing = globalByModel.get(key) ?? { total: 0, tokens: 0, calls: 0 };
				existing.total += r.cost.total;
				existing.tokens += r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite;
				existing.calls += 1;
				globalByModel.set(key, existing);
			}

			if (globalByModel.size > 0) {
				lines.push(theme.fg("accent", "  By model"));
				lines.push(theme.fg("dim", "  ─".padEnd(60, "─")));
				const sorted = [...globalByModel.entries()].sort((a, b) => b[1].total - a[1].total);
				for (const [model, data] of sorted) {
					lines.push(
						`  ${theme.fg("dim", model.padEnd(45))} ${theme.bold(fmtCost(data.total).padStart(8))}  ${theme.fg("dim", `${fmtTokens(data.tokens)} tok · ${data.calls} calls`)}`,
					);
				}
			}

			if (allRecords.length === 0) {
				lines.push(theme.fg("dim", "  No cost data recorded for this period."));
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
