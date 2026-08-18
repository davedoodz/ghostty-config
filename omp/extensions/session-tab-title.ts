import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { settings } from "@oh-my-pi/pi-coding-agent";
import { generateSessionTitle } from "@oh-my-pi/pi-coding-agent/utils/title-generator";

const TITLE_PROMPT = `# Task
Write a title of one or two short words for the task in <user>.

The complete title must be at most 18 characters so it remains fully readable in a terminal tab. Prefer a concrete noun or a verb followed by a noun. Preserve names and technical terms exactly. Do not add punctuation, labels, quotes, or explanations. If there is no task, output <title/>.`;

/** Terminal tabs cannot color text, so the repo marker is a colored glyph. */
const DOTS = ["🟢", "🔵", "🟣", "🟠", "🔴", "🟡", "🟤", "⚪", "⚫"];

/** repo root -> dot, so every open repo keeps one stable, unique color. */
const REGISTRY = join(homedir(), ".omp", "agent", "tab-dots.json");

const TITLE_BUDGET = 18;

interface DotEntry {
	dot: string;
	seen: number;
}

function fitTab(title: string): string {
	const words = title.trim().split(/\s+/u).slice(0, 2);
	const twoWords = words.join(" ");
	if ([...twoWords].length <= TITLE_BUDGET) return twoWords;
	if ([...words[0]].length <= TITLE_BUDGET) return words[0];
	return [...words[0]].slice(0, TITLE_BUDGET).join("");
}

function repoRootOf(cwd: string): string {
	const start = resolve(cwd);
	let dir = start;
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return start;
		dir = parent;
	}
}

/** Reads the registry, dropping malformed entries and folders that are gone. */
function readRegistry(): Map<string, DotEntry> {
	const registry = new Map<string, DotEntry>();
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(REGISTRY, "utf8"));
	} catch {
		return registry;
	}
	if (typeof parsed !== "object" || parsed === null) return registry;

	const taken = new Set<string>();
	for (const [root, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (typeof value !== "object" || value === null) continue;
		const { dot, seen } = value as { dot?: unknown; seen?: unknown };
		if (typeof dot !== "string" || !DOTS.includes(dot) || taken.has(dot)) continue;
		if (!existsSync(root)) continue;
		taken.add(dot);
		registry.set(root, { dot, seen: typeof seen === "number" ? seen : 0 });
	}
	return registry;
}

function writeRegistry(registry: Map<string, DotEntry>): void {
	try {
		mkdirSync(dirname(REGISTRY), { recursive: true });
		const tmp = `${REGISTRY}.${process.pid}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(Object.fromEntries(registry), null, "\t")}\n`);
		renameSync(tmp, REGISTRY);
	} catch {
		// The dot is cosmetic: a read-only or racing registry must not break the session.
	}
}

/**
 * Resolves this workspace's dot: reuse the recorded one, else claim a free
 * color, else steal the color of the least recently used repo so the dots in
 * play stay distinct even once the palette is exhausted.
 */
function claimDot(repoRoot: string): string {
	const registry = readRegistry();
	let dot = registry.get(repoRoot)?.dot;

	if (!dot) {
		const taken = new Set([...registry.values()].map((entry) => entry.dot));
		dot = DOTS.find((candidate) => !taken.has(candidate));
	}
	if (!dot) {
		let lruRoot = "";
		let lru: DotEntry | undefined;
		for (const [root, entry] of registry) {
			if (!lru || entry.seen < lru.seen) {
				lruRoot = root;
				lru = entry;
			}
		}
		dot = lru?.dot ?? DOTS[0];
		registry.delete(lruRoot);
	}

	registry.set(repoRoot, { dot, seen: Date.now() });
	writeRegistry(registry);
	return dot;
}

export default function sessionTabTitle(pi: ExtensionAPI): void {
	let requestVersion = 0;
	let activeRequest: AbortController | undefined;
	/** Empty until session_start resolves the workspace color. */
	let dotSuffix = "";

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		const repoRoot = repoRootOf(ctx.cwd);
		dotSuffix = ` ${claimDot(repoRoot)}`;
		ctx.ui.setTitle(`${pi.getSessionName() ?? fitTab(basename(repoRoot))}${dotSuffix}`);
	});

	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive" || !event.text.trim()) return;

		activeRequest?.abort();
		const controller = new AbortController();
		activeRequest = controller;
		const version = ++requestVersion;
		const sessionId = ctx.sessionManager.getSessionId();

		const generated = await generateSessionTitle(
			event.text,
			ctx.modelRegistry,
			settings,
			sessionId,
			ctx.model,
			undefined,
			TITLE_PROMPT,
			controller.signal,
		);

		if (
			!generated ||
			controller.signal.aborted ||
			version !== requestVersion ||
			ctx.sessionManager.getSessionId() !== sessionId
		) {
			return;
		}

		const title = fitTab(generated);
		if (!title) return;

		await pi.setSessionName(title);
		ctx.ui.setTitle(`${title}${dotSuffix}`);
	});

	pi.on("session_shutdown", () => {
		activeRequest?.abort();
	});
}
