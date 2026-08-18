import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { settings } from "@oh-my-pi/pi-coding-agent";
import { generateSessionTitle } from "@oh-my-pi/pi-coding-agent/utils/title-generator";

const TITLE_PROMPT = `# Task
Write a title of one or two short words for the task in <user>.

The complete title must be at most 18 characters so it remains fully readable in a terminal tab. Prefer a concrete noun or a verb followed by a noun. Preserve names and technical terms exactly. Do not add punctuation, labels, quotes, or explanations. If there is no task, output <title/>.`;

/** Terminal tabs cannot color text, so status and repo identity use glyphs. */
const DOTS = ["🟢", "🔵", "🟣", "🟠", "🔴", "🟡", "🟤", "⚪", "⚫"];
const ALERT_PREFIX = "⚠️";
const DONE_PREFIX = "✅";

/** Matches decorations this extension may have persisted in a session name. */
const DOT_SUFFIX = new RegExp(`\\s*[${DOTS.join("")}]$`, "u");
const STATUS_PREFIX = /^(?:⚠️|✅)\s*/u;

/** repo root -> dot, so every open repo keeps one stable, unique color. */
const REGISTRY = join(homedir(), ".omp", "agent", "tab-dots.json");

const TITLE_BUDGET = 18;

type TabState = "working" | "waiting" | "done";

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
	let dotSuffix = "";
	let fallbackTitle = "";
	let tabState: TabState = "working";
	const pendingInput = new Set<string>();

	const decorate = (name: string): string => {
		const title = name.replace(DOT_SUFFIX, "").replace(STATUS_PREFIX, "");
		const statusPrefix =
			tabState === "waiting" ? `${ALERT_PREFIX} ` : tabState === "done" ? `${DONE_PREFIX} ` : "";
		return `${statusPrefix}${title}${dotSuffix}`;
	};

	const renderState = async (ctx: ExtensionContext): Promise<void> => {
		if (!ctx.hasUI) return;
		const name = pi.getSessionName();
		if (!name) {
			if (fallbackTitle) ctx.ui.setTitle(decorate(fallbackTitle));
			return;
		}
		const decorated = decorate(name);
		if (decorated !== name) await pi.setSessionName(decorated);
	};

	const setTabState = async (state: TabState, ctx: ExtensionContext): Promise<void> => {
		tabState = state;
		await renderState(ctx);
	};

	const waitForInput = async (key: string, ctx: ExtensionContext): Promise<void> => {
		pendingInput.add(key);
		await setTabState("waiting", ctx);
	};

	const releaseInput = async (key: string, ctx: ExtensionContext): Promise<void> => {
		pendingInput.delete(key);
		if (pendingInput.size === 0) await setTabState("working", ctx);
	};

	const updateTitle = async (
		text: string,
		ctx: ExtensionContext,
		controller: AbortController,
		version: number,
	): Promise<void> => {
		const sessionId = ctx.sessionManager.getSessionId();
		try {
			const generated = await generateSessionTitle(
				text,
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

			// Keep the current lifecycle marker: title generation can finish after an
			// approval or ask prompt has already started.
			await pi.setSessionName(decorate(title));
		} catch {
			// The title is cosmetic: provider or persistence failures must not affect input.
		} finally {
			if (activeRequest === controller) activeRequest = undefined;
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const repoRoot = repoRootOf(ctx.cwd);
		dotSuffix = ` ${claimDot(repoRoot)}`;
		fallbackTitle = fitTab(basename(repoRoot));
		pendingInput.clear();

		// A named session is idle when opened, so show it as complete. A fresh,
		// unnamed session stays neutral until its first turn finishes.
		const name = pi.getSessionName();
		tabState = name ? "done" : "working";
		if (name) await pi.setSessionName(decorate(name));
		else ctx.ui.setTitle(decorate(fallbackTitle));
	});

	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive" || !event.text.trim()) return;

		pendingInput.clear();
		await setTabState("working", ctx);
		activeRequest?.abort();
		const controller = new AbortController();
		activeRequest = controller;
		const version = ++requestVersion;
		void updateTitle(event.text, ctx, controller, version);
	});

	pi.on("turn_start", async (_event, ctx) => {
		pendingInput.clear();
		await setTabState("working", ctx);
	});

	pi.on("tool_approval_requested", async (event, ctx) => {
		await waitForInput(`approval:${event.toolCallId}`, ctx);
	});

	pi.on("tool_approval_resolved", async (event, ctx) => {
		await releaseInput(`approval:${event.toolCallId}`, ctx);
	});

	// The ask tool blocks while its dialog waits for a selection or typed answer.
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "ask") await waitForInput(`ask:${event.toolCallId}`, ctx);
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName === "ask") await releaseInput(`ask:${event.toolCallId}`, ctx);
	});

	// Core auto-titles and /rename may write an undecorated name during a turn.
	// Re-stamp the settled title and replace any alert with the completion mark.
	pi.on("turn_end", async (_event, ctx) => {
		pendingInput.clear();
		await setTabState("done", ctx);
	});

	pi.on("session_shutdown", () => {
		activeRequest?.abort();
		pendingInput.clear();
	});
}
