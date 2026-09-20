import { constants, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, parse, resolve } from "node:path";
import { resolvePath } from "../utils/paths.ts";
import type { AgentSession } from "./agent-session.ts";
import type { AgentSessionRuntimeDiagnostic, AgentSessionServices } from "./agent-session-services.ts";
import type {
	ProjectTrustContext,
	ReplacedSessionContext,
	SessionShutdownEvent,
	SessionStartEvent,
} from "./extensions/index.ts";
import { emitSessionShutdownEvent } from "./extensions/runner.ts";
import { assertCwdInsidePiRoot, assertSessionCwdInsidePiRoot } from "./pi-root.ts";
import type { CreateAgentSessionResult } from "./sdk.ts";
import { assertSessionCwdExists } from "./session-cwd.ts";
import { getDefaultSessionDir, SessionManager } from "./session-manager.ts";
import { SessionPool, type SessionSlot } from "./session-pool.ts";

/**
 * Result returned by runtime creation.
 *
 * The caller gets the created session, its cwd-bound services, and all
 * diagnostics collected during setup.
 */
export interface CreateAgentSessionRuntimeResult extends CreateAgentSessionResult {
	services: AgentSessionServices;
	diagnostics: AgentSessionRuntimeDiagnostic[];
}

/**
 * Creates a full runtime for a target cwd and session manager.
 *
 * The factory closes over process-global fixed inputs, recreates cwd-bound
 * services for the effective cwd, resolves session options against those
 * services, and finally creates the AgentSession.
 */
export type CreateAgentSessionRuntimeFactory = (options: {
	cwd: string;
	agentDir: string;
	sessionManager: SessionManager;
	sessionStartEvent?: SessionStartEvent;
	projectTrustContext?: ProjectTrustContext;
}) => Promise<CreateAgentSessionRuntimeResult>;

/**
 * Thrown when /import references a JSONL file path that does not exist.
 */
export class SessionImportFileNotFoundError extends Error {
	readonly filePath: string;

	constructor(filePath: string) {
		super(`File not found: ${filePath}`);
		this.name = "SessionImportFileNotFoundError";
		this.filePath = filePath;
	}
}

function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

/**
 * Owns the current AgentSession plus its cwd-bound services.
 *
 * Session replacement methods tear down the current runtime first, then create
 * and apply the next runtime. If creation fails, the error is propagated to the
 * caller. The caller is responsible for user-facing error handling.
 */
export class AgentSessionRuntime {
	private rebindSession?: (session: AgentSession) => Promise<void>;
	private beforeForegroundSwitch?: () => void;
	private beforeSessionInvalidate?: () => void;
	private readonly _sessionPool: SessionPool;
	private readonly createRuntime: CreateAgentSessionRuntimeFactory;
	private _diagnostics: AgentSessionRuntimeDiagnostic[];
	private _modelFallbackMessage?: string;
	private replacementSlot?: SessionSlot;

	constructor(
		_session: AgentSession,
		_services: AgentSessionServices,
		createRuntime: CreateAgentSessionRuntimeFactory,
		_diagnostics: AgentSessionRuntimeDiagnostic[] = [],
		_modelFallbackMessage?: string,
		_sessionPool = new SessionPool(),
	) {
		this._sessionPool = _sessionPool;
		const initialSlot = this._sessionPool.adopt(_session, _services);
		this._sessionPool.setForeground(initialSlot.id);
		this.createRuntime = createRuntime;
		this._diagnostics = _diagnostics;
		this._modelFallbackMessage = _modelFallbackMessage;
	}

	get sessionPool(): SessionPool {
		return this._sessionPool;
	}

	subscribeActivity(listener: Parameters<SessionPool["subscribeActivity"]>[0]): () => void {
		return this._sessionPool.subscribeActivity(listener);
	}

	get services(): AgentSessionServices {
		return this._sessionPool.getForeground().services;
	}

	get session(): AgentSession {
		return this._sessionPool.getForeground().session;
	}

	get cwd(): string {
		return this._sessionPool.getForeground().cwd;
	}

	get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] {
		return this._diagnostics;
	}

	get modelFallbackMessage(): string | undefined {
		return this._modelFallbackMessage;
	}

	setRebindSession(rebindSession?: (session: AgentSession) => Promise<void>): void {
		this.rebindSession = rebindSession;
	}

	/**
	 * Set a synchronous callback that runs after `session_shutdown` handlers finish
	 * but before the current session is invalidated.
	 *
	 * This is for host-owned UI teardown that must not yield to the event loop,
	 * such as detaching extension-provided TUI components before the old extension
	 * context becomes stale.
	 */
	setBeforeForegroundSwitch(beforeForegroundSwitch?: () => void): void {
		this.beforeForegroundSwitch = beforeForegroundSwitch;
	}

	setBeforeSessionInvalidate(beforeSessionInvalidate?: () => void): void {
		this.beforeSessionInvalidate = beforeSessionInvalidate;
	}

	private async emitBeforeSwitch(
		reason: "new" | "resume",
		targetSessionFile?: string,
	): Promise<{ cancelled: boolean }> {
		const runner = this.session.extensionRunner;
		if (!runner.hasHandlers("session_before_switch")) {
			return { cancelled: false };
		}

		const result = await runner.emit({
			type: "session_before_switch",
			reason,
			targetSessionFile,
		});
		return { cancelled: result?.cancel === true };
	}

	private async emitBeforeFork(
		entryId: string,
		options: { position: "before" | "at" },
	): Promise<{ cancelled: boolean }> {
		const runner = this.session.extensionRunner;
		if (!runner.hasHandlers("session_before_fork")) {
			return { cancelled: false };
		}

		const result = await runner.emit({
			type: "session_before_fork",
			entryId,
			...options,
		});
		return { cancelled: result?.cancel === true };
	}

	private async disposeSlot(
		slot: SessionSlot,
		reason: SessionShutdownEvent["reason"],
		targetSessionFile?: string,
		remove = true,
	): Promise<void> {
		// Settle any active response first so the aborted turn (including tool
		// results) is persisted to the outgoing session before it is replaced.
		this._sessionPool.suppressCompletion(slot.id);
		await slot.session.abort();
		await emitSessionShutdownEvent(slot.session.extensionRunner, {
			type: "session_shutdown",
			reason,
			targetSessionFile,
		});
		if (slot.id === this._sessionPool.foregroundSlotId) this.beforeSessionInvalidate?.();
		slot.session.dispose();
		if (remove) this._sessionPool.removeClosed(slot.id);
	}

	async parkForeground(): Promise<void> {
		await this._sessionPool.getForeground().session.abort();
	}

	async switchForeground(slotId: string): Promise<void> {
		if (this._sessionPool.foregroundSlotId !== slotId) this.beforeForegroundSwitch?.();
		this._sessionPool.setForeground(slotId);
		await this.finishSessionReplacement();
	}

	private async teardownCurrent(reason: SessionShutdownEvent["reason"], targetSessionFile?: string): Promise<void> {
		this.replacementSlot = this._sessionPool.getForeground();
		await this.disposeSlot(this.replacementSlot, reason, targetSessionFile, false);
	}

	private apply(result: CreateAgentSessionRuntimeResult, setForeground = true): SessionSlot {
		const slot = this._sessionPool.adopt(result.session, result.services);
		if (setForeground) this._sessionPool.setForeground(slot.id);
		if (this.replacementSlot) {
			this._sessionPool.removeClosed(this.replacementSlot.id);
			this.replacementSlot = undefined;
		}
		this._diagnostics = result.diagnostics;
		this._modelFallbackMessage = result.modelFallbackMessage;
		return slot;
	}

	private async finishSessionReplacement(withSession?: (ctx: ReplacedSessionContext) => Promise<void>): Promise<void> {
		if (this.rebindSession) {
			await this.rebindSession(this.session);
		}
		if (withSession) {
			await withSession(this.session.createReplacedSessionContext());
		}
	}

	async prepareSession(
		sessionPath: string,
		options?: {
			cwdOverride?: string;
			projectTrustContextFactory?: (cwd: string) => ProjectTrustContext;
		},
	): Promise<{ result: CreateAgentSessionRuntimeResult; sessionManager: SessionManager }> {
		const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
		assertSessionCwdInsidePiRoot(sessionManager.getCwd(), `for resumed session ${sessionPath}`);
		assertSessionCwdExists(sessionManager, this.cwd);
		const result = await this.createRuntime({
			cwd: sessionManager.getCwd(),
			agentDir: this.services.agentDir,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile: this.session.sessionFile },
			projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
		});
		return { result, sessionManager };
	}

	async resumePrepared(
		prepared: { result: CreateAgentSessionRuntimeResult; sessionManager: SessionManager },
		withSession?: (ctx: ReplacedSessionContext) => Promise<void>,
	): Promise<void> {
		const slot = this.apply(prepared.result, false);
		await this.switchForeground(slot.id);
		if (withSession) await withSession(this.session.createReplacedSessionContext());
	}

	async switchSession(
		sessionPath: string,
		options?: {
			cwdOverride?: string;
			withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
			projectTrustContextFactory?: (cwd: string) => ProjectTrustContext;
		},
	): Promise<{ cancelled: boolean }> {
		const beforeResult = await this.emitBeforeSwitch("resume", sessionPath);
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
		assertSessionCwdInsidePiRoot(sessionManager.getCwd(), `for resumed session ${sessionPath}`);
		assertSessionCwdExists(sessionManager, this.cwd);
		await this.teardownCurrent("resume", sessionManager.getSessionFile());
		this.apply(
			await this.createRuntime({
				cwd: sessionManager.getCwd(),
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
				projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
			}),
		);
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false };
	}

	async prepareNewSession(options?: {
		parentSession?: string;
		cwd?: string;
	}): Promise<{ result: CreateAgentSessionRuntimeResult; sessionManager: SessionManager }> {
		const targetCwd = options?.cwd ? resolvePath(options.cwd) : this.cwd;
		// Defense-in-depth: SessionManager.create also enforces this.
		assertCwdInsidePiRoot(targetCwd);
		const previousSessionFile = this.session.sessionFile;
		const sessionManager = SessionManager.create(targetCwd, getDefaultSessionDir(targetCwd, this.services.agentDir));
		if (options?.parentSession) sessionManager.newSession({ parentSession: options.parentSession });
		assertSessionCwdExists(sessionManager, this.cwd);
		const result = await this.createRuntime({
			cwd: targetCwd,
			agentDir: this.services.agentDir,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
		});
		return { result, sessionManager };
	}

	async newSession(options?: {
		parentSession?: string;
		cwd?: string;
		keepCurrent?: boolean;
		setup?: (sessionManager: SessionManager) => Promise<void>;
		withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
	}): Promise<{ cancelled: boolean }> {
		// Warm new sessions stay live in the pool; replacement hooks such as
		// pi-mux must not intercept this path and swap in a separate process.
		if (!options?.keepCurrent) {
			const beforeResult = await this.emitBeforeSwitch("new");
			if (beforeResult.cancelled) {
				return beforeResult;
			}
		}

		const prepared = await this.prepareNewSession(options);
		if (options?.keepCurrent) {
			const slot = this.apply(prepared.result, false);
			await this.switchForeground(slot.id);
		} else {
			await this.teardownCurrent("new", prepared.sessionManager.getSessionFile());
			this.apply(prepared.result);
		}
		if (options?.setup) {
			await options.setup(this.session.sessionManager);
			this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
		}
		if (options?.keepCurrent) {
			if (options.withSession) await options.withSession(this.session.createReplacedSessionContext());
		} else {
			await this.finishSessionReplacement(options?.withSession);
		}
		return { cancelled: false };
	}

	async fork(
		entryId: string,
		options?: { position?: "before" | "at"; withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
	): Promise<{ cancelled: boolean; selectedText?: string }> {
		const position = options?.position ?? "before";
		const beforeResult = await this.emitBeforeFork(entryId, { position });
		if (beforeResult.cancelled) {
			return { cancelled: true };
		}
		let targetLeafId: string | null;
		let selectedText: string | undefined;

		const selectedEntry = this.session.sessionManager.getEntry(entryId);
		if (!selectedEntry) {
			throw new Error("Invalid entry ID for forking");
		}

		if (position === "at") {
			targetLeafId = selectedEntry.id;
		} else {
			if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
				throw new Error("Invalid entry ID for forking");
			}
			targetLeafId = selectedEntry.parentId;
			selectedText = extractUserMessageText(selectedEntry.message.content);
		}

		const previousSessionFile = this.session.sessionFile;
		if (this.session.sessionManager.isPersisted()) {
			const currentSessionFile = this.session.sessionFile;
			if (!currentSessionFile) {
				throw new Error("Persisted session is missing a session file");
			}
			const sessionDir = this.session.sessionManager.getSessionDir();
			if (!targetLeafId) {
				const sessionManager = SessionManager.create(this.cwd, sessionDir);
				sessionManager.newSession({ parentSession: currentSessionFile });
				await this.teardownCurrent("fork", sessionManager.getSessionFile());
				this.apply(
					await this.createRuntime({
						cwd: this.cwd,
						agentDir: this.services.agentDir,
						sessionManager,
						sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
					}),
				);
				await this.finishSessionReplacement(options?.withSession);
				return { cancelled: false, selectedText };
			}

			if (!existsSync(currentSessionFile)) {
				throw new Error(
					"This session has not been saved yet. Wait for the first assistant response before cloning or forking it.",
				);
			}
			const sessionManager = SessionManager.open(currentSessionFile, sessionDir);
			const forkedSessionPath = sessionManager.createBranchedSession(targetLeafId);
			if (!forkedSessionPath) {
				throw new Error("Failed to create forked session");
			}
			await this.teardownCurrent("fork", sessionManager.getSessionFile());
			this.apply(
				await this.createRuntime({
					cwd: sessionManager.getCwd(),
					agentDir: this.services.agentDir,
					sessionManager,
					sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
				}),
			);
			await this.finishSessionReplacement(options?.withSession);
			return { cancelled: false, selectedText };
		}

		const sessionManager = this.session.sessionManager;
		await this.teardownCurrent("fork", sessionManager.getSessionFile());
		if (!targetLeafId) {
			sessionManager.newSession({ parentSession: previousSessionFile });
		} else {
			sessionManager.createBranchedSession(targetLeafId);
		}
		this.apply(
			await this.createRuntime({
				cwd: this.cwd,
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
			}),
		);
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false, selectedText };
	}

	/**
	 * Import a session JSONL file and switch runtime state to the imported session.
	 *
	 * @returns `{ cancelled: true }` when cancelled by `session_before_switch`, otherwise `{ cancelled: false }`.
	 * @throws {SessionImportFileNotFoundError} When the input path does not exist.
	 * @throws {MissingSessionCwdError} When the imported session cwd cannot be resolved and no override is provided.
	 */
	async importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }> {
		const resolvedPath = resolvePath(inputPath);
		if (!existsSync(resolvedPath)) {
			throw new SessionImportFileNotFoundError(resolvedPath);
		}

		const sessionDir = this.session.sessionManager.getSessionDir();
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}

		let destinationPath = join(sessionDir, basename(resolvedPath));
		const sourceAlreadyStored = resolve(destinationPath) === resolvedPath;
		if (!sourceAlreadyStored) {
			const { name, ext } = parse(destinationPath);
			let suffix = 1;
			while (existsSync(destinationPath)) {
				destinationPath = join(sessionDir, `${name}-${suffix++}${ext}`);
			}
		}
		const beforeResult = await this.emitBeforeSwitch("resume", destinationPath);
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		if (!sourceAlreadyStored) {
			copyFileSync(resolvedPath, destinationPath, constants.COPYFILE_EXCL);
		}

		const sessionManager = SessionManager.open(destinationPath, sessionDir, cwdOverride);
		assertSessionCwdInsidePiRoot(sessionManager.getCwd(), `for imported session ${destinationPath}`);
		assertSessionCwdExists(sessionManager, this.cwd);
		await this.teardownCurrent("resume", sessionManager.getSessionFile());
		this.apply(
			await this.createRuntime({
				cwd: sessionManager.getCwd(),
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
			}),
		);
		await this.finishSessionReplacement();
		return { cancelled: false };
	}

	async abortSession(slotId: string): Promise<boolean> {
		const slot = this._sessionPool.get(slotId);
		if (!slot || !slot.activity.busy) return false;
		this._sessionPool.suppressCompletion(slotId);
		await slot.session.abort();
		return true;
	}

	async closeSession(slotId: string, reason: SessionShutdownEvent["reason"] = "quit"): Promise<boolean> {
		const slot = this._sessionPool.get(slotId);
		if (!slot) return false;
		if (this._sessionPool.list().length === 1) return false;
		const wasForeground = slot.id === this._sessionPool.foregroundSlotId;
		if (wasForeground) {
			const successor = this._sessionPool.list().find((candidate) => candidate.id !== slot.id);
			if (!successor) return false;
			await this.disposeSlot(slot, reason);
			this._sessionPool.setForeground(successor.id);
			await this.finishSessionReplacement();
			return true;
		}
		await this.disposeSlot(slot, reason);
		return true;
	}

	async closeSlot(slotId: string, reason: SessionShutdownEvent["reason"] = "quit"): Promise<void> {
		await this.closeSession(slotId, reason);
	}

	async dispose(): Promise<void> {
		for (const slot of this._sessionPool.list()) {
			await this.disposeSlot(slot, "quit");
		}
	}
}

/**
 * Create the initial runtime from a runtime factory and initial session target.
 *
 * The same factory is stored on the returned AgentSessionRuntime and reused for
 * later /new, /resume, /fork, and import flows.
 */
export async function createAgentSessionRuntime(
	createRuntime: CreateAgentSessionRuntimeFactory,
	options: {
		cwd: string;
		agentDir: string;
		sessionManager: SessionManager;
		sessionStartEvent?: SessionStartEvent;
	},
): Promise<AgentSessionRuntime> {
	assertSessionCwdExists(options.sessionManager, options.cwd);
	const result = await createRuntime(options);
	return new AgentSessionRuntime(
		result.session,
		result.services,
		createRuntime,
		result.diagnostics,
		result.modelFallbackMessage,
	);
}

export {
	type AgentSessionRuntimeDiagnostic,
	type AgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionServicesOptions,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./agent-session-services.ts";
