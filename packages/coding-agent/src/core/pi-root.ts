/**
 * PiRoot: the fixed, Pi-instance-level workspace root.
 *
 * PiRoot is resolved once at startup and never changes while Pi runs, even
 * when the foreground session switches between directories inside the root.
 * It is deliberately independent of:
 *   - `process.cwd()` after startup
 *   - the current foreground session cwd
 *   - `git rev-parse --show-toplevel` (a PiRoot may or may not be a Git repo)
 *
 * A directory qualifies as a PiRoot when it contains a `control/` directory.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve as nodeResolvePath, relative, sep } from "node:path";

/** Marker directory that identifies a PiRoot. */
export const PI_ROOT_MARKER = ".pi";
export const LEGACY_PI_ROOT_MARKER = "control";

/** Thrown when PiRoot cannot be resolved. */
export class PiRootNotFoundError extends Error {
	readonly searchedFrom: string | undefined;
	readonly explicitRoot: string | undefined;

	constructor(options: { searchedFrom?: string; explicitRoot?: string }) {
		const detail = options.explicitRoot
			? `--root ${options.explicitRoot} does not contain a ${PI_ROOT_MARKER}/ directory`
			: `no ancestor of ${options.searchedFrom} contains a ${PI_ROOT_MARKER}/ directory`;
		super(
			`Could not determine PiRoot: ${detail}. Start Pi inside a workspace root that contains ${PI_ROOT_MARKER}/, or pass --root <path>.`,
		);
		this.name = "PiRootNotFoundError";
		this.searchedFrom = options.searchedFrom;
		this.explicitRoot = options.explicitRoot;
	}
}

/** Thrown when a user-supplied path escapes PiRoot. */
export class PiRootPathError extends Error {
	readonly input: string;

	constructor(message: string, input: string) {
		super(message);
		this.name = "PiRootPathError";
		this.input = input;
	}
}

export type PiRootMode = "formal" | "legacy";

export interface PiRootResolution {
	root: string;
	controlDir: string;
	mode: PiRootMode;
}

let activePiRoot: string | undefined;
let activePiRootMode: PiRootMode | undefined;

/** The fixed PiRoot for this process, if resolved. */
export function hasFormalPiRootMarker(root: string): boolean {
	return hasPiRootMarker(root);
}

export function getPiRoot(): string | undefined {
	return activePiRoot;
}

/** Set the process-level PiRoot. Passing `undefined` clears it. */
export function setPiRoot(root: string | undefined, mode?: PiRootMode): void {
	activePiRoot = root === undefined ? undefined : canonicalizePath(root);
	activePiRootMode = root === undefined ? undefined : (mode ?? (hasPiRootMarker(activePiRoot!) ? "formal" : "legacy"));
}

export function getPiRootMode(): PiRootMode | undefined {
	return activePiRootMode;
}

function canonicalizePath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return nodeResolvePath(path);
	}
}

/**
 * Canonicalize a possibly-not-yet-existing path by canonicalizing its nearest
 * existing ancestor and re-appending the missing suffix. This makes symlink
 * escape checks meaningful for paths that will be created.
 */
export function canonicalizeAllowMissing(path: string): string {
	let current = nodeResolvePath(path);
	const missing: string[] = [];
	for (;;) {
		if (existsSync(current)) {
			const canonical = canonicalizePath(current);
			return missing.length === 0 ? canonical : join(canonical, ...missing.reverse());
		}
		const parent = dirname(current);
		if (parent === current) return nodeResolvePath(path);
		missing.push(current.slice(parent.length + 1));
		current = parent;
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** True when `dir` contains the formal `.pi/` marker. */
export function hasPiRootMarker(dir: string): boolean {
	return isDirectory(join(dir, PI_ROOT_MARKER));
}

/** True when `dir` contains the legacy `control/` marker. */
export function hasLegacyPiRootMarker(dir: string): boolean {
	return isDirectory(join(dir, LEGACY_PI_ROOT_MARKER));
}

/**
 * Walk from `startCwd` toward the filesystem root and return the nearest
 * ancestor containing `control/`.
 */
export function findPiRootFromCwd(startCwd: string): string | undefined {
	let current = canonicalizeAllowMissing(startCwd);
	for (;;) {
		if (hasPiRootMarker(current)) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/**
 * Resolve PiRoot.
 *
 * Order:
 *   1. Explicit `--root <path>` (must contain `control/`).
 *   2. Nearest ancestor of `cwd` containing `control/`.
 *   3. Failure.
 */
export function resolvePiRootInfo(options: { explicitRoot?: string; cwd: string }): PiRootResolution {
	const explicit = options.explicitRoot !== undefined && options.explicitRoot !== "";
	const root = explicit ? canonicalizeAllowMissing(options.explicitRoot!) : findPiRootFromCwd(options.cwd);
	if (root !== undefined && hasPiRootMarker(root)) {
		return { root, controlDir: canonicalizePath(join(root, PI_ROOT_MARKER)), mode: "formal" };
	}
	if (explicit && root !== undefined && hasLegacyPiRootMarker(root)) {
		return { root, controlDir: canonicalizePath(join(root, LEGACY_PI_ROOT_MARKER)), mode: "legacy" };
	}
	let current = canonicalizeAllowMissing(options.cwd);
	for (;;) {
		if (hasLegacyPiRootMarker(current)) {
			return { root: current, controlDir: canonicalizePath(join(current, LEGACY_PI_ROOT_MARKER)), mode: "legacy" };
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	throw new PiRootNotFoundError(explicit ? { explicitRoot: options.explicitRoot } : { searchedFrom: options.cwd });
}

export function resolvePiRoot(options: { explicitRoot?: string; cwd: string }): string {
	return resolvePiRootInfo(options).root;
}

/** True when `target` resolves to `root` itself or a descendant of it. */
export function isPathInsidePiRoot(target: string, root: string | undefined = activePiRoot): boolean {
	if (!root) return false;
	const canonicalRoot = canonicalizeAllowMissing(root);
	const canonicalTarget = canonicalizeAllowMissing(target);
	const rel = relative(canonicalRoot, canonicalTarget);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Assert that a session's cwd is inside the current PiRoot.
 *
 * Throws `PiRootPathError` when PiRoot is set and the session cwd
 * falls outside it. When PiRoot is not set, this is a no-op.
 */
export function assertSessionCwdInsidePiRoot(sessionCwd: string, inputLabel: string): void {
	const root = getPiRoot();
	if (!root) return;
	if (!isPathInsidePiRoot(sessionCwd, root)) {
		throw new PiRootPathError(`Session cwd ${inputLabel} is outside PiRoot (${root}): ${sessionCwd}`, sessionCwd);
	}
}

/**
 * Assert that a candidate cwd is inside the current PiRoot.
 *
 * Used by runtime transitions (new / resume / fork / import) before
 * the session is created. Mirrors the same containment check as the
 * SessionManager layer so both chokepoints use identical logic.
 */
export function assertCwdInsidePiRoot(candidateCwd: string): void {
	const root = getPiRoot();
	if (!root) return;
	const canonical = canonicalizeAllowMissing(candidateCwd);
	if (!isPathInsidePiRoot(canonical, root)) {
		throw new PiRootPathError(`Working directory is outside PiRoot (${root}): ${candidateCwd}`, candidateCwd);
	}
}

/**
 * Resolve a PiRoot-relative path argument (used by `/new <path>`).
 *
 * Rejects absolute paths outright and rejects anything that escapes PiRoot
 * after canonicalization (including `..` and symlink traversal).
 */
export function resolvePiRootRelativePath(input: string, root: string | undefined = activePiRoot): string {
	if (!root) {
		throw new PiRootPathError("PiRoot is not set; cannot resolve a relative path.", input);
	}
	if (isAbsolute(input)) {
		throw new PiRootPathError(`Absolute paths are not allowed here: ${input}. Use a path relative to PiRoot.`, input);
	}
	const canonicalRoot = canonicalizeAllowMissing(root);
	const candidate = nodeResolvePath(canonicalRoot, input);
	const canonicalTarget = canonicalizeAllowMissing(candidate);
	if (!isPathInsidePiRoot(canonicalTarget, canonicalRoot)) {
		throw new PiRootPathError(`Path escapes PiRoot (${canonicalRoot}): ${input}`, input);
	}
	return canonicalTarget;
}

/** Derive a short display label for a path relative to PiRoot. */
export function getPiRootControlCwd(root: string | undefined = activePiRoot): string | undefined {
	if (root === undefined) return undefined;
	const formal = join(root, PI_ROOT_MARKER);
	return canonicalizePath(existsSync(formal) ? formal : join(root, LEGACY_PI_ROOT_MARKER));
}

export function getPiRootControlDir(root: string | undefined = activePiRoot): string | undefined {
	return getPiRootControlCwd(root);
}

export function formatPiRootRelativePath(target: string, root: string | undefined = activePiRoot): string {
	if (!root) return target;
	const canonicalRoot = canonicalizeAllowMissing(root);
	const canonicalTarget = canonicalizeAllowMissing(target);
	const rel = relative(canonicalRoot, canonicalTarget);
	return rel === "" ? "." : rel.split(sep).join("/");
}
