import React, {
	useState,
	useEffect,
	useLayoutEffect,
	useCallback,
	useRef,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { NoteEditor } from "./components/NoteEditor";
import { TodoList } from "./components/TodoList";
import { supabase, makeSupabaseClient } from "./lib/supabase";
import { deleteAllNoteImages, deleteAllNoteFiles } from "./lib/storage";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faPenToSquare,
	faChevronDown,
	faGear,
	faCircleQuestion,
	faPencil,
	faFolder,
	faCheck,
	faPlus,
	faTrash,
	faPen,
	faMagnifyingGlass,
	faXmark,
	faBug,
	faEye,
	faSquareCheck,
} from "@fortawesome/free-solid-svg-icons";
import "./App.css";

export interface Note {
	id: string;
	content: string;
	created_at: number;
	updated_at: number;
	pinned: boolean;
	list: string;
	deleted: boolean;
	deleted_at: number | null;
}

// Extract the display title and a short preview from a Tiptap JSON string.
// Title = first non-empty block; preview = next non-empty block after that.
function extractPreview(content: string): { title: string; preview: string } {
	if (!content) return { title: "", preview: "" };
	try {
		const doc = JSON.parse(content);
		const blocks: any[] = doc.content ?? [];
		const getBlockText = (block: any): string => {
			if (!block) return "";
			if (block.type === "text") return block.text ?? "";
			return (block.content ?? []).map(getBlockText).join("");
		};
		let title = "";
		let titleIdx = -1;
		for (let i = 0; i < blocks.length; i++) {
			const text = getBlockText(blocks[i]).trim();
			if (text) {
				title = text;
				titleIdx = i;
				break;
			}
		}
		let preview = "";
		for (let i = titleIdx + 1; i < blocks.length; i++) {
			const text = getBlockText(blocks[i]).trim();
			if (text) {
				preview = text;
				break;
			}
		}
		return { title, preview };
	} catch {
		return { title: "", preview: "" };
	}
}

function extractAllText(content: string): string {
	if (!content) return "";
	try {
		const doc = JSON.parse(content);
		const blocks: any[] = doc.content ?? [];
		const getBlockText = (block: any): string => {
			if (!block) return "";
			if (block.type === "text") return block.text ?? "";
			return (block.content ?? []).map(getBlockText).join("");
		};
		return blocks
			.map((b) => getBlockText(b).trim())
			.filter(Boolean)
			.join(" ");
	} catch {
		return "";
	}
}

function isNoteEmpty(content: string): boolean {
	if (!content) return true;
	try {
		const doc = JSON.parse(content);
		const blocks: any[] = doc.content ?? [];
		const hasContent = (node: any): boolean => {
			if (!node) return false;
			if (node.type === "text" && node.text?.trim()) return true;
			if (node.type === "image" || node.type === "resizableImage") return true;
			if (node.type === "fileAttachment") return true;
			if (node.content?.some(hasContent)) return true;
			return false;
		};
		return !blocks.some(hasContent);
	} catch {
		return true;
	}
}

function getSearchSnippet(
	content: string,
	query: string,
): { before: string; match: string; after: string } | null {
	const allText = extractAllText(content);
	if (!allText || !query) return null;
	const lower = allText.toLowerCase();
	const lowerQ = query.toLowerCase();
	const idx = lower.indexOf(lowerQ);
	if (idx === -1) return null;
	const start = Math.max(0, idx - 30);
	const end = Math.min(allText.length, idx + query.length + 40);
	return {
		before: (start > 0 ? "\u2026" : "") + allText.slice(start, idx),
		match: allText.slice(idx, idx + query.length),
		after:
			allText.slice(idx + query.length, end) +
			(end < allText.length ? "\u2026" : ""),
	};
}

function highlightText(text: string, query: string): React.ReactNode {
	if (!query) return text;
	const lower = text.toLowerCase();
	const lowerQ = query.toLowerCase();
	const parts: React.ReactNode[] = [];
	let lastIdx = 0;
	let idx = lower.indexOf(lowerQ);
	let key = 0;
	while (idx !== -1) {
		if (idx > lastIdx) parts.push(text.slice(lastIdx, idx));
		parts.push(
			<mark className="search-highlight" key={key++}>
				{text.slice(idx, idx + query.length)}
			</mark>,
		);
		lastIdx = idx + query.length;
		idx = lower.indexOf(lowerQ, lastIdx);
	}
	if (lastIdx < text.length) parts.push(text.slice(lastIdx));
	return parts.length > 0 ? <>{parts}</> : text;
}

function formatDate(ts: number): string {
	const d = new Date(ts * 1000);
	const now = new Date();
	if (d.toDateString() === now.toDateString()) {
		return d.toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
		});
	}
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
	const diffDays = (now.getTime() - d.getTime()) / 86_400_000;
	if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(2)} MB`;
}

type SortNotesBy = "date_edited" | "date_created" | "title";
type NewNoteStart = "title" | "heading" | "subheading" | "body";

type LoginState = "idle" | "loading" | "success" | "exiting";
type AuthMode = "login" | "signup" | "forgot";

function AuthPage({
	onLogin,
}: {
	onLogin: (client: SupabaseClient, user: User) => void;
}) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [signUpDisplayName, setSignUpDisplayName] = useState("");
	const [rememberMe, setRememberMe] = useState(true);
	const [mode, setMode] = useState<AuthMode>("login");
	const [loginState, setLoginState] = useState<LoginState>("idle");
	const [error, setError] = useState<string | null>(null);
	const [infoMessage, setInfoMessage] = useState<string | null>(null);

	const busy = loginState !== "idle";

	function resetMessages() {
		setError(null);
		setInfoMessage(null);
	}

	function switchMode(next: AuthMode) {
		resetMessages();
		setSignUpDisplayName("");
		setMode(next);
	}

	async function handleLogin() {
		if (busy || !email.trim() || !password) return;
		resetMessages();
		setLoginState("loading");
		const client = makeSupabaseClient(rememberMe);
		if (!client) {
			setError("Supabase is not configured. Check your environment variables.");
			setLoginState("idle");
			return;
		}
		const { data, error: authError } = await client.auth.signInWithPassword({
			email: email.trim(),
			password,
		});
		if (authError || !data.user) {
			setError(authError?.message ?? "Sign in failed.");
			setLoginState("idle");
			return;
		}
		setLoginState("success");
		setTimeout(() => {
			setLoginState("exiting");
			setTimeout(() => onLogin(client, data.user!), 480);
		}, 1900);
	}

	async function handleSignUp() {
		if (busy || !email.trim() || !password || !signUpDisplayName.trim()) return;
		resetMessages();

		// Check display name uniqueness before creating account
		if (supabase) {
			const { data: existing } = await supabase
				.from("users")
				.select("user_id")
				.eq("display_name", signUpDisplayName.trim())
				.maybeSingle();
			if (existing) {
				setError("That display name is already taken. Choose another.");
				return;
			}
		}

		setLoginState("loading");
		const client = makeSupabaseClient(rememberMe);
		if (!client) {
			setError("Supabase is not configured.");
			setLoginState("idle");
			return;
		}
		const { data, error: authError } = await client.auth.signUp({
			email: email.trim(),
			password,
			options: { data: { display_name: signUpDisplayName.trim() } },
		});
		if (authError) {
			setError(authError.message);
			setLoginState("idle");
			return;
		}
		if (data.user && data.session) {
			setLoginState("success");
			setTimeout(() => {
				setLoginState("exiting");
				setTimeout(() => onLogin(client, data.user!), 480);
			}, 1900);
		} else {
			setLoginState("idle");
			setMode("login");
			setInfoMessage("Check your email to confirm your account, then sign in.");
		}
	}

	async function handleForgotPassword() {
		if (busy || !email.trim()) {
			setError("Enter your email address first.");
			return;
		}
		resetMessages();
		setLoginState("loading");
		const client = makeSupabaseClient(true);
		if (!client) {
			setError("Supabase is not configured.");
			setLoginState("idle");
			return;
		}
		const { error: authError } = await client.auth.resetPasswordForEmail(
			email.trim(),
		);
		setLoginState("idle");
		if (authError) {
			setError(authError.message);
		} else {
			setMode("login");
			setInfoMessage("Password reset email sent — check your inbox.");
		}
	}

	function handleSubmit() {
		if (mode === "login") handleLogin();
		else if (mode === "signup") handleSignUp();
		else handleForgotPassword();
	}

	const submitLabel =
		mode === "login"
			? "Sign in"
			: mode === "signup"
				? "Create account"
				: "Send reset link";

	return (
		<div className="auth-overlay">
			<div
				className={`auth-card${loginState === "exiting" ? " auth-card-exiting" : ""}`}
			>
				{(loginState === "success" || loginState === "exiting") && (
					<div className="auth-success-overlay">
						<div className="auth-check-circle">
							<svg viewBox="0 0 24 24" fill="none" width="26" height="26">
								<path
									className="auth-check-path"
									d="M5 12l5 5 9-9"
									stroke="white"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
						</div>
						<span className="auth-success-text">
							{mode === "signup" ? "Account created!" : "Welcome back!"}
						</span>
					</div>
				)}
				<div className="auth-logo">
					<img
						src="/matcha_logo_dark.png"
						alt="Matcha"
						width="80"
						height="64"
					/>
				</div>
				<h1 className="auth-title">Matcha</h1>
				<div className="auth-form">
					{error && <div className="auth-error">{error}</div>}
					{infoMessage && <div className="auth-info">{infoMessage}</div>}
					<div className="auth-field">
						<label className="auth-label">Email</label>
						<input
							className="auth-input"
							type="email"
							placeholder="you@example.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
							disabled={busy}
						/>
					</div>
					{mode === "signup" && (
						<div className="auth-field">
							<label className="auth-label">Display name</label>
							<input
								className="auth-input"
								type="text"
								placeholder="Choose a unique display name"
								value={signUpDisplayName}
								onChange={(e) => setSignUpDisplayName(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
								disabled={busy}
							/>
						</div>
					)}
					{mode !== "forgot" && (
						<div className="auth-field">
							<div className="auth-label-row">
								<label className="auth-label">Password</label>
								{mode === "login" && (
									<button
										className="auth-forgot-btn"
										onClick={() => switchMode("forgot")}
										disabled={busy}
									>
										Forgot password?
									</button>
								)}
							</div>
							<div className="auth-input-wrapper">
								<input
									className="auth-input auth-input-password"
									type={showPassword ? "text" : "password"}
									placeholder="••••••••"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
									disabled={busy}
								/>
								<button
									className="auth-password-toggle"
									onClick={() => setShowPassword((v) => !v)}
									tabIndex={-1}
									title="Reveal"
									aria-label={
										showPassword ? "Hide password" : "Reveal password"
									}
									disabled={busy}
								>
									{showPassword ? (
										<svg
											viewBox="0 0 20 20"
											fill="none"
											xmlns="http://www.w3.org/2000/svg"
											width="16"
											height="16"
										>
											<path
												d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinejoin="round"
											/>
											<circle
												cx="10"
												cy="10"
												r="2.5"
												stroke="currentColor"
												strokeWidth="1.5"
											/>
										</svg>
									) : (
										<svg
											viewBox="0 0 20 20"
											fill="none"
											xmlns="http://www.w3.org/2000/svg"
											width="16"
											height="16"
										>
											<path
												d="M3 3l14 14M8.5 8.6A2.5 2.5 0 0012.4 12.5M6.3 6.4C4.3 7.6 2.9 9.3 2 10c1.5 2.5 4.5 6 8 6 1.5 0 2.9-.5 4.1-1.3M10 4c3.5 0 6.5 3.5 8 6-.5.9-1.2 1.9-2.1 2.7"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									)}
								</button>
							</div>
						</div>
					)}
					{mode === "login" && (
						<label className="auth-remember-row">
							<input
								className="auth-remember-checkbox"
								type="checkbox"
								checked={rememberMe}
								onChange={(e) => setRememberMe(e.target.checked)}
								disabled={busy}
							/>
							<span className="auth-remember-label">Remember me</span>
						</label>
					)}
					<button
						className={`auth-submit-btn${loginState === "loading" ? " auth-btn-loading" : ""}`}
						onClick={handleSubmit}
						disabled={busy}
					>
						{loginState === "loading" ? (
							<span className="auth-btn-spinner" />
						) : (
							submitLabel
						)}
					</button>
					{mode === "forgot" ? (
						<p className="auth-signup-row">
							<button
								className="auth-signup-link"
								onClick={() => switchMode("login")}
								disabled={busy}
							>
								Back to sign in
							</button>
						</p>
					) : mode === "login" ? (
						<p className="auth-signup-row">
							Don't have an account?{" "}
							<button
								className="auth-signup-link"
								onClick={() => switchMode("signup")}
								disabled={busy}
							>
								Sign up
							</button>
						</p>
					) : (
						<p className="auth-signup-row">
							Already have an account?{" "}
							<button
								className="auth-signup-link"
								onClick={() => switchMode("login")}
								disabled={busy}
							>
								Sign in
							</button>
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

function App() {
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [sessionChecked, setSessionChecked] = useState(!supabase);
	const [user, setUser] = useState<User | null>(null);
	const activeSupabase = useRef<SupabaseClient | null>(null);
	const [notes, setNotes] = useState<Note[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		noteId: string;
	} | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const renameInputRef = useRef<HTMLInputElement>(null);
	const [sidebarWidth, setSidebarWidth] = useState(240);
	const [pinnedExpanded, setPinnedExpanded] = useState(true);
	const [sidebarFocused, setSidebarFocused] = useState(false);
	const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
	const selectionAnchorId = useRef<string | null>(null);
	const noteListRef = useRef<HTMLDivElement>(null);
	const shouldAutoFocusEditor = useRef(true);
	const pendingNoteIds = useRef(new Set<string>());
	const latestEditorContent = useRef<{ id: string; content: string } | null>(
		null,
	);
	const recentlyCleanedUpIds = useRef(new Set<string>());
	const [aboutOpen, setAboutOpen] = useState(false);
	const [accountOpen, setAccountOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [theme, setTheme] = useState<"dark" | "matcha" | "light">(
		() =>
			(localStorage.getItem("matcha_theme") as "dark" | "matcha" | "light") ||
			"dark",
	);
	const [sortNotesBy, setSortNotesBy] = useState<SortNotesBy>(
		() =>
			(localStorage.getItem("matcha_sortNotesBy") as SortNotesBy) ||
			"date_edited",
	);
	const [newNoteStartWith, setNewNoteStartWith] = useState<NewNoteStart>(
		() =>
			(localStorage.getItem("matcha_newNoteStartWith") as NewNoteStart) ||
			"title",
	);
	const [autoSortChecked, setAutoSortChecked] = useState<boolean>(
		() => localStorage.getItem("matcha_autoSortChecked") !== "false",
	);
	const [displayName, setDisplayName] = useState("User");
	const [editingDisplayName, setEditingDisplayName] = useState(false);
	const [displayNameValue, setDisplayNameValue] = useState("User");
	const displayNameInputRef = useRef<HTMLInputElement>(null);
	const [editingPassword, setEditingPassword] = useState(false);
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [passwordSaving, setPasswordSaving] = useState(false);
	const [showNewPassword, setShowNewPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);
	const [avatarNum, setAvatarNum] = useState<number | null>(null);
	const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
	const [pendingAvatarNum, setPendingAvatarNum] = useState<number | null>(null);
	const [bugReportOpen, setBugReportOpen] = useState(false);
	const [bugDescription, setBugDescription] = useState("");
	const [bugSteps, setBugSteps] = useState("");
	const [bugErrors, setBugErrors] = useState<{
		description?: boolean;
		steps?: boolean;
	}>({});
	const [bugSubmitting, setBugSubmitting] = useState(false);
	const [userRole, setUserRole] = useState<string>("User");
	const [viewBugsOpen, setViewBugsOpen] = useState(false);
	const [bugReports, setBugReports] = useState<
		{
			user_id: string;
			description: string;
			steps: string;
			created_at: string;
			display_name?: string;
		}[]
	>([]);
	const [expandedBugId, setExpandedBugId] = useState<string | null>(null);
	const [bugReportsLoading, setBugReportsLoading] = useState(false);
	const [toastMessage, setToastMessage] = useState<string | null>(null);
	const [toastIsError, setToastIsError] = useState(false);
	const [storageUsedLabel, setStorageUsedLabel] = useState("–");
	const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
	const [noteLists, setNoteLists] = useState<string[]>(() => {
		const saved = localStorage.getItem("matcha_noteLists");
		return saved ? JSON.parse(saved) : ["My Notes"];
	});
	const [activeFolder, setActiveFolder] = useState<string>(
		() => localStorage.getItem("matcha_activeList") || "My Notes",
	);
	const folderDropdownRef = useRef<HTMLDivElement>(null);
	const [manageListsOpen, setManageListsOpen] = useState(false);
	const [newListName, setNewListName] = useState("");
	const [renamingListIdx, setRenamingListIdx] = useState<number | null>(null);
	const [renameListValue, setRenameListValue] = useState("");
	const renameListInputRef = useRef<HTMLInputElement>(null);
	const newListInputRef = useRef<HTMLInputElement>(null);
	const [showTodoList, setShowTodoList] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const searchInputRef = useRef<HTMLInputElement>(null);
	const [sharedNoteCreator, setSharedNoteCreator] = useState<string | null>(
		null,
	);
	const isResizing = useRef(false);
	const startX = useRef(0);
	const startWidth = useRef(0);

	const SIDEBAR_MIN = 200;
	const SIDEBAR_MAX = 480;

	const onResizeStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			isResizing.current = true;
			startX.current = e.clientX;
			startWidth.current = sidebarWidth;

			const onMove = (ev: MouseEvent) => {
				if (!isResizing.current) return;
				const delta = ev.clientX - startX.current;
				const next = Math.min(
					SIDEBAR_MAX,
					Math.max(SIDEBAR_MIN, startWidth.current + delta),
				);
				setSidebarWidth(next);
			};

			const onUp = () => {
				isResizing.current = false;
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
			};

			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		},
		[sidebarWidth],
	);

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		localStorage.setItem("matcha_theme", theme);
	}, [theme]);

	useEffect(() => {
		if (!folderDropdownOpen) return;
		function handleClick(e: MouseEvent) {
			if (
				folderDropdownRef.current &&
				!folderDropdownRef.current.contains(e.target as Node)
			) {
				setFolderDropdownOpen(false);
			}
		}
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") setFolderDropdownOpen(false);
		}
		window.addEventListener("mousedown", handleClick);
		window.addEventListener("keydown", handleKey);
		return () => {
			window.removeEventListener("mousedown", handleClick);
			window.removeEventListener("keydown", handleKey);
		};
	}, [folderDropdownOpen]);

	useEffect(() => {
		if (!contextMenu) return;
		const close = () => setContextMenu(null);
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setContextMenu(null);
		};
		window.addEventListener("click", close);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("click", close);
			window.removeEventListener("keydown", onKey);
		};
	}, [contextMenu]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (manageListsOpen) closeManageLists();
			else if (aboutOpen) closeAbout();
			else if (accountOpen) closeAccount();
			else if (settingsOpen) setSettingsOpen(false);
		};
		if (aboutOpen || accountOpen || settingsOpen || manageListsOpen) {
			window.addEventListener("keydown", onKey);
			return () => window.removeEventListener("keydown", onKey);
		}
	}, [aboutOpen, accountOpen, settingsOpen, manageListsOpen]);

	useEffect(() => {
		function handleCmdF(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === "f") {
				e.preventDefault();
				searchInputRef.current?.focus();
				searchInputRef.current?.select();
			}
		}
		window.addEventListener("keydown", handleCmdF);
		return () => window.removeEventListener("keydown", handleCmdF);
	}, []);

	useEffect(() => {
		cleanupEmptyNote(selectedId);
		setSearchQuery("");
		const listNotes =
			activeFolder === "Recently Deleted"
				? notes.filter((n) => n.deleted)
				: notes.filter((n) => n.list === activeFolder && !n.deleted);
		if (listNotes.length > 0) {
			const sorted = [...listNotes].sort((a, b) => b.updated_at - a.updated_at);
			setSelectedId(sorted[0].id);
			setSelectedNoteIds([sorted[0].id]);
			selectionAnchorId.current = sorted[0].id;
		} else {
			setSelectedId(null);
			setSelectedNoteIds([]);
		}
	}, [activeFolder]);

	useEffect(() => {
		if (renamingListIdx !== null && renameListInputRef.current) {
			renameListInputRef.current.focus();
			renameListInputRef.current.select();
		}
	}, [renamingListIdx]);

	useEffect(() => {
		if (renamingId && renameInputRef.current) {
			renameInputRef.current.focus();
			renameInputRef.current.select();
		}
	}, [renamingId]);

	useEffect(() => {
		if (editingDisplayName && displayNameInputRef.current) {
			displayNameInputRef.current.focus();
			displayNameInputRef.current.select();
		}
	}, [editingDisplayName]);

	// Sync display name from Supabase user metadata when user changes
	useEffect(() => {
		if (user) {
			const name =
				user.user_metadata?.display_name || user.user_metadata?.full_name || "";
			if (name) {
				setDisplayName(name);
				setDisplayNameValue(name);
			}
		}
	}, [user]);

	useEffect(() => {
		if (user && activeSupabase.current) {
			activeSupabase.current
				.from("users")
				.select("avatar_num, role")
				.eq("user_id", user.id)
				.maybeSingle()
				.then(({ data }) => {
					if (data?.avatar_num) setAvatarNum(data.avatar_num);
					if (data?.role) setUserRole(data.role);
				});
		}
	}, [user]);

	useEffect(() => {
		if (!accountOpen) return;
		const db = activeSupabase.current;
		if (!db || !user) {
			const enc = new TextEncoder();
			const bytes = notes.reduce(
				(sum, n) => sum + enc.encode(n.content).length,
				0,
			);
			setStorageUsedLabel(formatBytes(bytes));
			return;
		}
		db.from("notes")
			.select("content")
			.eq("user_id", user.id)
			.then(({ data, error: fetchErr }) => {
				if (fetchErr || !data) return;
				const enc = new TextEncoder();
				const bytes = data.reduce(
					(sum: number, n: { content: string }) =>
						sum + enc.encode(n.content).length,
					0,
				);
				setStorageUsedLabel(formatBytes(bytes));
			});
	}, [accountOpen, user, notes]);

	useEffect(() => {
		if (
			activeFolder !== "Shared List" ||
			!selectedId ||
			!activeSupabase.current
		) {
			setSharedNoteCreator(null);
			return;
		}
		const db = activeSupabase.current;
		db.from("notes")
			.select("user_id")
			.eq("id", selectedId)
			.maybeSingle()
			.then(async ({ data }) => {
				if (!data?.user_id) {
					setSharedNoteCreator(null);
					return;
				}
				const { data: userData } = await db
					.from("users")
					.select("display_name")
					.eq("user_id", data.user_id)
					.maybeSingle();
				setSharedNoteCreator(userData?.display_name || null);
			});
	}, [selectedId, activeFolder]);

	useEffect(() => {
		invoke<Note[]>("get_notes")
			.then((loaded) => {
				const sorted = [...loaded].sort((a, b) => b.updated_at - a.updated_at);
				setNotes(sorted);
				const inList =
					activeFolder === "Recently Deleted"
						? sorted.filter((n) => n.deleted)
						: sorted.filter((n) => n.list === activeFolder && !n.deleted);
				if (inList.length > 0) {
					setSelectedId(inList[0].id);
					setSelectedNoteIds([inList[0].id]);
				}
			})
			.finally(() => setLoading(false));

		const client = supabase;
		if (client) {
			// getUser() validates the JWT against the server on every startup —
			// unlike getSession() which only reads the local cache and can return
			// a stale token for a deleted/invalid user.
			client.auth.getUser().then(({ data: { user: serverUser }, error }) => {
				if (serverUser && !error) {
					activeSupabase.current = client;
					setUser(serverUser);
					setIsAuthenticated(true);
				} else {
					// Stale or invalid token — wipe it so the auth page shows cleanly.
					client.auth.signOut();
				}
				setSessionChecked(true);
			});

			// Catch mid-session invalidation: refresh token expiry, sign-out from
			// another device, or the user being deleted from auth.users.
			const {
				data: { subscription },
			} = client.auth.onAuthStateChange((event, session) => {
				if (event === "SIGNED_OUT" || !session) {
					activeSupabase.current = null;
					setUser(null);
					setIsAuthenticated(false);
				} else if (session?.user) {
					setUser(session.user);
				}
			});

			return () => subscription.unsubscribe();
		}
	}, []);

	const prevNoteRects = useRef<Map<string, DOMRect>>(new Map());

	useLayoutEffect(() => {
		const container = noteListRef.current;
		if (!container) return;

		const items = container.querySelectorAll<HTMLElement>("[data-note-id]");
		const newRects = new Map<string, DOMRect>();

		items.forEach((el) => {
			const id = el.getAttribute("data-note-id")!;
			newRects.set(id, el.getBoundingClientRect());
		});

		if (prevNoteRects.current.size > 0) {
			items.forEach((el) => {
				const id = el.getAttribute("data-note-id")!;
				const oldRect = prevNoteRects.current.get(id);
				const newRect = newRects.get(id);
				if (oldRect && newRect) {
					const deltaY = oldRect.top - newRect.top;
					if (Math.abs(deltaY) > 1) {
						el.style.transform = `translateY(${deltaY}px)`;
						el.style.transition = "none";
						el.getBoundingClientRect();
						el.style.transition = "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
						el.style.transform = "";
						const onEnd = () => {
							el.style.transition = "";
							el.removeEventListener("transitionend", onEnd);
						};
						el.addEventListener("transitionend", onEnd);
					}
				}
			});
		}

		prevNoteRects.current = newRects;
	}, [notes, sortNotesBy]);

	async function saveDisplayName(newName: string) {
		const trimmed = newName.trim() || displayName;
		setDisplayName(trimmed);
		setDisplayNameValue(trimmed);
		setEditingDisplayName(false);
		if (activeSupabase.current) {
			const { error } = await activeSupabase.current.auth.updateUser({
				data: { display_name: trimmed },
			});
			if (error) console.warn("Failed to update display name:", error.message);

			if (user) {
				const { error: dbError } = await activeSupabase.current
					.from("users")
					.update({ display_name: trimmed })
					.eq("user_id", user.id);
				if (dbError)
					console.warn("Failed to update users table:", dbError.message);
			}
		}
	}

	async function handlePasswordSave() {
		if (!newPassword) {
			setPasswordError("Enter a new password.");
			return;
		}
		if (newPassword.length < 6) {
			setPasswordError("Password must be at least 6 characters.");
			return;
		}
		if (newPassword !== confirmPassword) {
			setPasswordError("Passwords don't match.");
			return;
		}
		setPasswordError(null);
		setPasswordSaving(true);
		try {
			if (!activeSupabase.current) throw new Error("Not connected.");
			const { error } = await activeSupabase.current.auth.updateUser({
				password: newPassword,
			});
			if (error) {
				setPasswordError(error.message);
			} else {
				setEditingPassword(false);
				setNewPassword("");
				setConfirmPassword("");
			}
		} finally {
			setPasswordSaving(false);
		}
	}

	async function saveAvatar(num: number) {
		setAvatarNum(num);
		setAvatarPickerOpen(false);
		setPendingAvatarNum(null);
		if (activeSupabase.current && user) {
			const { error } = await activeSupabase.current
				.from("users")
				.update({ avatar_num: num })
				.eq("user_id", user.id);
			if (error) console.warn("Failed to update avatar:", error.message);
		}
	}

	function persistLists(lists: string[]) {
		setNoteLists(lists);
		localStorage.setItem("matcha_noteLists", JSON.stringify(lists));
	}

	function addList(name: string) {
		const trimmed = name.trim();
		if (!trimmed || noteLists.includes(trimmed)) return;
		persistLists([...noteLists, trimmed]);
		setNewListName("");
	}

	async function removeList(idx: number) {
		if (noteLists.length <= 1) return;
		const removed = noteLists[idx];
		const next = noteLists.filter((_, i) => i !== idx);
		const target = next[0];
		persistLists(next);

		await invoke("update_note_list", { oldList: removed, newList: target });
		setNotes((prev) =>
			prev.map((n) => (n.list === removed ? { ...n, list: target } : n)),
		);

		const db = activeSupabase.current;
		if (db && user) {
			db.from("notes")
				.update({ list: target })
				.eq("user_id", user.id)
				.eq("list", removed);
		}

		if (activeFolder === removed) {
			setActiveFolder(target);
			localStorage.setItem("matcha_activeList", target);
		}
	}

	async function finishRenameList(idx: number, newName: string) {
		const trimmed = newName.trim();
		setRenamingListIdx(null);
		if (!trimmed || trimmed === noteLists[idx]) return;
		if (noteLists.includes(trimmed)) return;
		const oldName = noteLists[idx];
		const wasActive = activeFolder === oldName;
		const next = noteLists.map((n, i) => (i === idx ? trimmed : n));
		persistLists(next);

		await invoke("update_note_list", { oldList: oldName, newList: trimmed });
		setNotes((prev) =>
			prev.map((n) => (n.list === oldName ? { ...n, list: trimmed } : n)),
		);

		const db = activeSupabase.current;
		if (db && user) {
			db.from("notes")
				.update({ list: trimmed })
				.eq("user_id", user.id)
				.eq("list", oldName);
		}

		if (wasActive) {
			setActiveFolder(trimmed);
			localStorage.setItem("matcha_activeList", trimmed);
		}
	}

	function closeManageLists() {
		setManageListsOpen(false);
		setRenamingListIdx(null);
		setRenameListValue("");
		setNewListName("");
	}

	function closeAccount() {
		setAccountOpen(false);
		setEditingDisplayName(false);
		setDisplayNameValue(displayName);
		setEditingPassword(false);
		setNewPassword("");
		setConfirmPassword("");
		setPasswordError(null);
		setShowNewPassword(false);
		setShowConfirmPassword(false);
		setAvatarPickerOpen(false);
		setPendingAvatarNum(null);
	}

	function closeAbout() {
		setAboutOpen(false);
		setBugReportOpen(false);
		setViewBugsOpen(false);
		setBugDescription("");
		setBugSteps("");
		setBugErrors({});
		setBugSubmitting(false);
		setExpandedBugId(null);
	}

	async function fetchBugReports() {
		const db = activeSupabase.current;
		if (!db) return;
		setBugReportsLoading(true);
		const { data, error } = await db
			.from("bug_reports")
			.select("user_id, description, steps, created_at")
			.order("created_at", { ascending: false });
		if (error) {
			console.warn("Failed to fetch bug reports:", error.message);
			setBugReportsLoading(false);
			return;
		}
		const userIds = [...new Set((data ?? []).map((r: any) => r.user_id))];
		let nameMap: Record<string, string> = {};
		if (userIds.length > 0) {
			const { data: users } = await db
				.from("users")
				.select("user_id, display_name")
				.in("user_id", userIds);
			if (users) {
				nameMap = Object.fromEntries(
					users.map((u: any) => [u.user_id, u.display_name]),
				);
			}
		}
		setBugReports(
			(data ?? []).map((r: any) => ({
				...r,
				display_name: nameMap[r.user_id] || "Unknown",
			})),
		);
		setBugReportsLoading(false);
	}

	async function submitBugReport() {
		const errors: { description?: boolean; steps?: boolean } = {};
		if (!bugDescription.trim()) errors.description = true;
		if (!bugSteps.trim()) errors.steps = true;
		if (Object.keys(errors).length > 0) {
			setBugErrors(errors);
			return;
		}
		setBugErrors({});
		setBugSubmitting(true);
		const db = activeSupabase.current;
		let errorMsg: string | null = null;
		if (!db || !user) {
			errorMsg = "You must be signed in to report a bug.";
		} else {
			const { error } = await db.from("bug_reports").insert({
				user_id: user.id,
				description: bugDescription.trim(),
				steps: bugSteps.trim(),
			});
			if (error) {
				console.warn("Bug report error:", error.message);
				errorMsg = "Failed to submit bug report. Please try again.";
			}
		}
		setBugSubmitting(false);
		closeAbout();
		setToastIsError(!!errorMsg);
		setToastMessage(errorMsg ?? "Thank you so much for reporting a bug 🐛");
		setTimeout(() => setToastMessage(null), 3500);
	}

	async function createNote() {
		cleanupEmptyNote(selectedId);
		setShowTodoList(false);
		shouldAutoFocusEditor.current = true;
		const note = await invoke<Note>("create_note", { list: activeFolder });
		pendingNoteIds.current.add(note.id);
		setNotes((prev) => [note, ...prev]);
		setSelectedId(note.id);
		setSelectedNoteIds([note.id]);
		selectionAnchorId.current = note.id;
	}

	const saveNote = useCallback(
		async (id: string, content: string) => {
			if (recentlyCleanedUpIds.current.has(id)) {
				recentlyCleanedUpIds.current.delete(id);
				return;
			}

			const updated = await invoke<Note>("update_note", { id, content });
			setNotes((prev) =>
				[...prev.map((n) => (n.id === updated.id ? updated : n))].sort(
					(a, b) => b.updated_at - a.updated_at,
				),
			);

			if (pendingNoteIds.current.has(id)) {
				if (isNoteEmpty(content)) return;
				pendingNoteIds.current.delete(id);
			}

			const db = activeSupabase.current;
			if (db && user) {
				db.from("notes")
					.upsert({
						id: updated.id,
						user_id: user.id,
						content: updated.content,
						list: updated.list,
						created_at: updated.created_at,
						updated_at: updated.updated_at,
					})
					.then(({ error }) => {
						if (error) console.warn("Supabase sync error:", error.message);
					});
			}
		},
		[user],
	);

	async function softDeleteNote(id: string) {
		const updated = await invoke<Note>("soft_delete_note", { id });
		setNotes((prev) => {
			const next = prev.map((n) => (n.id === updated.id ? updated : n));
			if (selectedId === id) {
				const inFolder = next.filter(
					(n) => n.list === activeFolder && !n.deleted,
				);
				setSelectedId(inFolder[0]?.id ?? null);
				setSelectedNoteIds(inFolder[0] ? [inFolder[0].id] : []);
			}
			return next;
		});

		const db = activeSupabase.current;
		if (db && user) {
			db.from("notes")
				.update({ deleted: true, deleted_at: updated.deleted_at })
				.eq("id", id)
				.then(({ error }) => {
					if (error) console.warn("Supabase soft-delete error:", error.message);
				});
		}
	}

	async function permanentDeleteNote(id: string) {
		await invoke("delete_note", { id });
		setNotes((prev) => {
			const remaining = prev.filter((n) => n.id !== id);
			if (selectedId === id) {
				const inFolder = remaining.filter((n) =>
					activeFolder === "Recently Deleted"
						? n.deleted
						: n.list === activeFolder,
				);
				setSelectedId(inFolder[0]?.id ?? null);
				setSelectedNoteIds(inFolder[0] ? [inFolder[0].id] : []);
			}
			return remaining;
		});

		const db = activeSupabase.current;
		if (db) {
			db.from("notes")
				.delete()
				.eq("id", id)
				.then(({ error }) => {
					if (error) console.warn("Supabase delete error:", error.message);
				});
			if (user) {
				deleteAllNoteImages(db, user.id, id);
				deleteAllNoteFiles(db, user.id, id);
			}
		}
	}

	async function restoreNote(id: string) {
		const updated = await invoke<Note>("restore_note", { id });
		setNotes((prev) => {
			const next = prev.map((n) => (n.id === updated.id ? updated : n));
			if (selectedId === id) {
				const inFolder = next.filter((n) => n.deleted);
				setSelectedId(inFolder[0]?.id ?? null);
				setSelectedNoteIds(inFolder[0] ? [inFolder[0].id] : []);
			}
			return next;
		});

		const db = activeSupabase.current;
		if (db && user) {
			db.from("notes")
				.update({ deleted: false, deleted_at: null })
				.eq("id", id)
				.then(({ error }) => {
					if (error) console.warn("Supabase restore error:", error.message);
				});
		}
	}

	async function deleteSelectedNotes() {
		const idsToDelete =
			selectedNoteIds.length > 0
				? selectedNoteIds
				: selectedId
					? [selectedId]
					: [];
		if (idsToDelete.length === 0) return;

		const isPermanent = activeFolder === "Recently Deleted";

		if (isPermanent) {
			for (const id of idsToDelete) {
				await permanentDeleteNote(id);
			}
		} else {
			for (const id of idsToDelete) {
				await softDeleteNote(id);
			}
		}
		noteListRef.current?.focus();
	}

	function cleanupEmptyNote(prevId: string | null) {
		if (!prevId) return;

		let content: string;
		if (latestEditorContent.current?.id === prevId) {
			content = latestEditorContent.current.content;
		} else {
			const note = notes.find((n) => n.id === prevId);
			content = note?.content ?? "";
		}

		if (!isNoteEmpty(content)) {
			if (pendingNoteIds.current.has(prevId)) {
				pendingNoteIds.current.delete(prevId);
				const note = notes.find((n) => n.id === prevId);
				if (note) {
					const db = activeSupabase.current;
					if (db && user) {
						db.from("notes")
							.upsert({
								id: note.id,
								user_id: user.id,
								content,
								list: note.list,
								created_at: note.created_at,
								updated_at: note.updated_at,
							})
							.then(({ error }) => {
								if (error) console.warn("Supabase sync error:", error.message);
							});
					}
				}
			}
			return;
		}

		const isPending = pendingNoteIds.current.has(prevId);
		pendingNoteIds.current.delete(prevId);
		recentlyCleanedUpIds.current.add(prevId);
		latestEditorContent.current = null;

		invoke("delete_note", { id: prevId });
		setNotes((prev) => prev.filter((n) => n.id !== prevId));
		setSelectedNoteIds((prev) => prev.filter((nid) => nid !== prevId));

		if (!isPending) {
			const db = activeSupabase.current;
			if (db) {
				db.from("notes")
					.delete()
					.eq("id", prevId)
					.then(({ error }) => {
						if (error) console.warn("Supabase delete error:", error.message);
					});
				if (user) {
					deleteAllNoteImages(db, user.id, prevId);
					deleteAllNoteFiles(db, user.id, prevId);
				}
			}
		}
	}

	async function duplicateNote(id: string) {
		const source = notes.find((n) => n.id === id);
		if (!source) return;
		const newNote = await invoke<Note>("create_note", { list: source.list });
		const updated = await invoke<Note>("update_note", {
			id: newNote.id,
			content: source.content,
		});
		setNotes((prev) =>
			[updated, ...prev.filter((n) => n.id !== newNote.id)].sort(
				(a, b) => b.updated_at - a.updated_at,
			),
		);
		setSelectedId(updated.id);
	}

	async function renameNote(id: string, newTitle: string) {
		const note = notes.find((n) => n.id === id);
		if (!note || !newTitle.trim()) return;
		let doc: any = { type: "doc", content: [] };
		try {
			doc = JSON.parse(note.content);
		} catch {}
		if (!Array.isArray(doc.content)) doc.content = [];
		if (doc.content.length > 0) {
			doc.content[0] = {
				...doc.content[0],
				content: [{ type: "text", text: newTitle.trim() }],
			};
		} else {
			doc.content = [
				{
					type: "paragraph",
					content: [{ type: "text", text: newTitle.trim() }],
				},
			];
		}
		const newContent = JSON.stringify(doc);
		await saveNote(id, newContent);
	}

	async function pinNote(id: string, pinned: boolean) {
		const updated = await invoke<Note>("pin_note", { id, pinned });
		setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
	}

	const sortFn = useCallback(
		(a: Note, b: Note) => {
			if (sortNotesBy === "date_created") return b.created_at - a.created_at;
			if (sortNotesBy === "title") {
				const aTitle = extractPreview(a.content).title.toLowerCase();
				const bTitle = extractPreview(b.content).title.toLowerCase();
				return aTitle.localeCompare(bTitle);
			}
			return b.updated_at - a.updated_at;
		},
		[sortNotesBy],
	);

	const isRecentlyDeleted = activeFolder === "Recently Deleted";
	const listFilteredNotes = isRecentlyDeleted
		? notes.filter((n) => n.deleted)
		: notes.filter((n) => n.list === activeFolder && !n.deleted);
	const filteredNotes = searchQuery.trim()
		? listFilteredNotes.filter((n) => {
				const text = extractAllText(n.content).toLowerCase();
				return text.includes(searchQuery.trim().toLowerCase());
			})
		: listFilteredNotes;
	const pinnedNotes = filteredNotes.filter((n) => n.pinned).sort(sortFn);
	const regularNotes = filteredNotes.filter((n) => !n.pinned).sort(sortFn);

	const selectedNote = notes.find((n) => n.id === selectedId) ?? null;
	const selectedNoteIsEmpty = selectedNote
		? isNoteEmpty(selectedNote.content)
		: false;

	const allVisibleNotes = searchQuery.trim()
		? [...filteredNotes].sort(sortFn)
		: [...(pinnedExpanded ? pinnedNotes : []), ...regularNotes];

	function handleNoteClick(note: Note, e: React.MouseEvent) {
		const isRenaming = renamingId === note.id;
		if (isRenaming) return;

		setShowTodoList(false);

		if (selectedId && selectedId !== note.id) {
			cleanupEmptyNote(selectedId);
		}

		shouldAutoFocusEditor.current = false;

		if (e.metaKey || e.ctrlKey) {
			const alreadySelected = selectedNoteIds.includes(note.id);

			if (alreadySelected && selectedNoteIds.length <= 1) {
				noteListRef.current?.focus();
				return;
			}

			if (alreadySelected) {
				const next = selectedNoteIds.filter((id) => id !== note.id);
				setSelectedNoteIds(next);
				if (selectedId === note.id) {
					setSelectedId(next[next.length - 1]);
				}
			} else {
				setSelectedNoteIds([...selectedNoteIds, note.id]);
				setSelectedId(note.id);
			}
			selectionAnchorId.current = note.id;
		} else if (e.shiftKey && selectionAnchorId.current) {
			const allIds = allVisibleNotes.map((n) => n.id);
			const anchorIdx = allIds.indexOf(selectionAnchorId.current);
			const clickIdx = allIds.indexOf(note.id);
			if (anchorIdx !== -1 && clickIdx !== -1) {
				const start = Math.min(anchorIdx, clickIdx);
				const end = Math.max(anchorIdx, clickIdx);
				setSelectedNoteIds(allIds.slice(start, end + 1));
			}
			setSelectedId(note.id);
		} else {
			setSelectedNoteIds([note.id]);
			setSelectedId(note.id);
			selectionAnchorId.current = note.id;
		}

		noteListRef.current?.focus();
	}

	function renderNoteItem(note: Note) {
		const { title, preview } = extractPreview(note.content);
		const isRenaming = renamingId === note.id;
		const isSelected = selectedNoteIds.includes(note.id);
		const trimmedSearch = searchQuery.trim();
		const searchSnippet = trimmedSearch
			? getSearchSnippet(note.content, trimmedSearch)
			: null;
		return (
			<button
				key={note.id}
				data-note-id={note.id}
				className={`note-item${!showTodoList && note.id === selectedId ? " active" : ""}${!showTodoList && isSelected && note.id !== selectedId ? " selected" : ""}${note.pinned ? " pinned" : ""}`}
				onClick={(e) => handleNoteClick(note, e)}
				onContextMenu={(e) => {
					e.preventDefault();
					e.stopPropagation();
					setContextMenu({ x: e.clientX, y: e.clientY, noteId: note.id });
				}}
			>
				{isRenaming ? (
					<input
						ref={renameInputRef}
						className="note-rename-input"
						value={renameValue}
						onChange={(e) => setRenameValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								renameNote(note.id, renameValue);
								setRenamingId(null);
							} else if (e.key === "Escape") {
								setRenamingId(null);
							}
						}}
						onBlur={() => {
							if (renameValue.trim()) renameNote(note.id, renameValue.trim());
							setRenamingId(null);
						}}
						onClick={(e) => e.stopPropagation()}
					/>
				) : (
					<div className="note-item-title">
						{trimmedSearch
							? highlightText(title || "New Note", trimmedSearch)
							: title || "New Note"}
					</div>
				)}
				<div className="note-item-meta">
					<span className="note-item-date">{formatDate(note.updated_at)}</span>
					{trimmedSearch && searchSnippet ? (
						<span className="note-item-preview">
							{searchSnippet.before}
							<mark className="search-highlight">{searchSnippet.match}</mark>
							{searchSnippet.after}
						</span>
					) : preview && !isRenaming ? (
						<span className="note-item-preview">{preview}</span>
					) : null}
				</div>
			</button>
		);
	}

	const TOTAL_AVATARS = 12;

	const avatarFallback = (
		<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
			<circle cx="16" cy="12" r="6" fill="currentColor" opacity="0.55" />
			<path
				d="M4 28c0-6.627 5.373-12 12-12s12 5.373 12 12"
				fill="currentColor"
				opacity="0.35"
			/>
		</svg>
	);

	if (!sessionChecked) return null;

	if (!isAuthenticated) {
		return (
			<AuthPage
				onLogin={(client, loggedInUser) => {
					activeSupabase.current = client;
					setUser(loggedInUser);
					setIsAuthenticated(true);
				}}
			/>
		);
	}

	return (
		<div className="app">
			{/* ── Sidebar ── */}
			<aside className="sidebar" style={{ width: sidebarWidth }}>
				<div className="sidebar-header">
					<div className="sidebar-user">
						<div
							className="sidebar-avatar"
							role="button"
							onClick={() => setAccountOpen(true)}
						>
							{avatarNum ? (
								<img
									src={`/avatars/avatar_${avatarNum}.png`}
									alt="Avatar"
									className="sidebar-avatar-img"
								/>
							) : (
								avatarFallback
							)}
						</div>
						<div className="sidebar-identity">
							<span className="sidebar-display-name">{displayName}</span>
							<span className="sidebar-note-count">
								{searchQuery.trim()
									? `Found ${filteredNotes.length} ${filteredNotes.length === 1 ? "note" : "notes"}`
									: `${filteredNotes.length} ${filteredNotes.length === 1 ? "note" : "notes"}`}
							</span>
						</div>
					</div>
					<button
						className="new-note-fab"
						onClick={createNote}
						title="New Note"
						disabled={selectedNoteIsEmpty || isRecentlyDeleted}
					>
						<FontAwesomeIcon icon={faPenToSquare} />
					</button>
				</div>

				<div className="sidebar-search-wrap">
					<FontAwesomeIcon
						icon={faMagnifyingGlass}
						className="sidebar-search-icon"
					/>
					<input
						ref={searchInputRef}
						className="sidebar-search-input"
						type="text"
						placeholder="Search"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								setSearchQuery("");
								searchInputRef.current?.blur();
							}
						}}
					/>
					{searchQuery && (
						<button
							className="sidebar-search-clear"
							onClick={() => {
								setSearchQuery("");
								searchInputRef.current?.focus();
							}}
							aria-label="Clear search"
						>
							<FontAwesomeIcon icon={faXmark} />
						</button>
					)}
				</div>

				<button
					className={`sidebar-todo-btn${showTodoList ? " active" : ""}`}
					onClick={() => {
						if (showTodoList) return;
						cleanupEmptyNote(selectedId);
						setShowTodoList(true);
					}}
				>
					<FontAwesomeIcon
						icon={faSquareCheck}
						className="sidebar-todo-btn-icon"
					/>
					<span>To-do List</span>
				</button>

				<div
					ref={noteListRef}
					tabIndex={0}
					className={`note-list${sidebarFocused ? " sidebar-focused" : ""}`}
					onMouseDown={() => setSidebarFocused(true)}
					onKeyDown={(e) => {
						if (e.key === "Delete" || e.key === "Backspace") {
							e.preventDefault();
							deleteSelectedNotes();
						} else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
							e.preventDefault();
							const ids = allVisibleNotes.map((n) => n.id);
							if (ids.length === 0) return;

							let targetIdx: number;
							if (selectedNoteIds.length > 1) {
								const indices = selectedNoteIds
									.map((id) => ids.indexOf(id))
									.filter((i) => i !== -1);
								if (indices.length === 0) return;
								if (e.key === "ArrowUp") {
									const topIdx = Math.min(...indices);
									targetIdx = topIdx > 0 ? topIdx - 1 : topIdx;
								} else {
									const bottomIdx = Math.max(...indices);
									targetIdx =
										bottomIdx < ids.length - 1 ? bottomIdx + 1 : bottomIdx;
								}
							} else {
								const currentIdx = ids.indexOf(selectedId ?? "");
								if (currentIdx === -1) {
									targetIdx = 0;
								} else {
									targetIdx =
										e.key === "ArrowUp" ? currentIdx - 1 : currentIdx + 1;
								}
							}

							if (targetIdx < 0 || targetIdx >= ids.length) return;
							const newId = ids[targetIdx];
							if (selectedId && selectedId !== newId) {
								cleanupEmptyNote(selectedId);
							}
							setSelectedId(newId);
							setSelectedNoteIds([newId]);
							selectionAnchorId.current = newId;

							requestAnimationFrame(() => {
								noteListRef.current
									?.querySelector(`[data-note-id="${newId}"]`)
									?.scrollIntoView({ block: "nearest" });
							});
						}
					}}
				>
					{loading ? (
						<p className="sidebar-empty">loading…</p>
					) : filteredNotes.length === 0 ? (
						<p className="sidebar-empty">
							{searchQuery.trim()
								? "No results"
								: isRecentlyDeleted
									? "No deleted notes"
									: "No notes yet"}
						</p>
					) : searchQuery.trim() ? (
						[...filteredNotes].sort(sortFn).map((note) => renderNoteItem(note))
					) : (
						<>
							{pinnedNotes.length > 0 && (
								<>
									<div
										className="note-list-section-label"
										onClick={() => setPinnedExpanded((v) => !v)}
									>
										<span>Pinned</span>
										<FontAwesomeIcon
											icon={faChevronDown}
											className={`section-chevron${pinnedExpanded ? "" : " collapsed"}`}
										/>
									</div>
									<div
										className={`pinned-accordion${pinnedExpanded ? " expanded" : ""}`}
									>
										<div className="pinned-accordion-inner">
											{pinnedNotes.map((note) => renderNoteItem(note))}
										</div>
									</div>
									<div className="note-list-divider" />
								</>
							)}
							{regularNotes.map((note) => renderNoteItem(note))}
						</>
					)}
				</div>
				<div className="sidebar-footer">
					<div
						className="sidebar-footer-left folder-picker-wrap"
						ref={folderDropdownRef}
					>
						<button
							className="sidebar-footer-folder-btn"
							onClick={() => setFolderDropdownOpen((v) => !v)}
						>
							<FontAwesomeIcon
								icon={faFolder}
								className="sidebar-footer-sort-icon"
							/>
							<span className="sidebar-footer-label">{activeFolder}</span>
							<FontAwesomeIcon
								icon={faChevronDown}
								className={`folder-chevron${folderDropdownOpen ? " open" : ""}`}
							/>
						</button>
						{folderDropdownOpen && (
							<div className="folder-dropdown">
								{noteLists.map((name) => (
									<button
										key={name}
										className={`folder-dropdown-item${activeFolder === name ? " active" : ""}`}
										onClick={() => {
											setActiveFolder(name);
											localStorage.setItem("matcha_activeList", name);
											setFolderDropdownOpen(false);
										}}
									>
										<span className="folder-dropdown-check-col">
											{activeFolder === name && (
												<FontAwesomeIcon icon={faCheck} />
											)}
										</span>
										<span className="folder-dropdown-name">{name}</span>
									</button>
								))}
								<div className="folder-dropdown-separator" />
								<button
									className={`folder-dropdown-item${activeFolder === "Shared List" ? " active" : ""}`}
									onClick={() => {
										setActiveFolder("Shared List");
										localStorage.setItem("matcha_activeList", "Shared List");
										setFolderDropdownOpen(false);
									}}
								>
									<span className="folder-dropdown-check-col">
										{activeFolder === "Shared List" && (
											<FontAwesomeIcon icon={faCheck} />
										)}
									</span>
									<span className="folder-dropdown-name">Shared List</span>
								</button>
								<button
									className={`folder-dropdown-item${activeFolder === "Recently Deleted" ? " active" : ""}`}
									onClick={() => {
										setActiveFolder("Recently Deleted");
										localStorage.setItem(
											"matcha_activeList",
											"Recently Deleted",
										);
										setFolderDropdownOpen(false);
									}}
								>
									<span className="folder-dropdown-check-col">
										{activeFolder === "Recently Deleted" && (
											<FontAwesomeIcon icon={faCheck} />
										)}
									</span>
									<span className="folder-dropdown-name">Recently Deleted</span>
								</button>
								<div className="folder-dropdown-separator" />
								<button
									className="folder-dropdown-item"
									onClick={() => {
										setFolderDropdownOpen(false);
										setManageListsOpen(true);
									}}
								>
									<span className="folder-dropdown-check-col">
										<FontAwesomeIcon icon={faPencil} />
									</span>
									<span className="folder-dropdown-name">Manage Lists…</span>
								</button>
							</div>
						)}
					</div>
					<div className="sidebar-footer-actions">
						<button
							className="sidebar-footer-btn"
							title="About"
							onClick={() => setAboutOpen(true)}
						>
							<FontAwesomeIcon icon={faCircleQuestion} />
						</button>
						<button
							className="sidebar-footer-btn"
							title="Settings"
							onClick={() => setSettingsOpen(true)}
						>
							<FontAwesomeIcon icon={faGear} />
						</button>
					</div>
				</div>
				<div className="sidebar-resize-handle" onMouseDown={onResizeStart} />
			</aside>

			{/* ── Main panel ── */}
			<main className="main" onMouseDown={() => setSidebarFocused(false)}>
				{showTodoList ? (
					<TodoList supabaseClient={activeSupabase.current} userId={user?.id} autoSortChecked={autoSortChecked} />
				) : selectedNote ? (
					<NoteEditor
						key={selectedNote.id}
						note={selectedNote}
						onSave={isRecentlyDeleted ? () => {} : saveNote}
						onDelete={
							isRecentlyDeleted
								? () => permanentDeleteNote(selectedNote.id)
								: () => softDeleteNote(selectedNote.id)
						}
						onRestore={
							isRecentlyDeleted ? () => restoreNote(selectedNote.id) : undefined
						}
						onContentChange={
							isRecentlyDeleted
								? undefined
								: (id, content) => {
										latestEditorContent.current = { id, content };
									}
						}
						newNoteStartWith={newNoteStartWith}
						autoSortChecked={autoSortChecked}
						autoFocus={
							isRecentlyDeleted ? false : shouldAutoFocusEditor.current
						}
						supabaseClient={activeSupabase.current}
						userId={user?.id}
						creatorName={
							activeFolder === "Shared List"
								? (sharedNoteCreator ?? undefined)
								: undefined
						}
						readOnly={isRecentlyDeleted}
					/>
				) : (
					<div className="empty-state">
						<p className="empty-state-text">
							{loading ? "loading…" : "Create a note to get started"}
						</p>
					</div>
				)}
			</main>
			{aboutOpen && (
				<div className="about-overlay" onClick={closeAbout}>
					<div
						className={`about-card-wrap${bugReportOpen ? " bug-report-open" : ""}${viewBugsOpen ? " view-bugs-open" : ""}`}
						onClick={(e) => e.stopPropagation()}
					>
						<div className="about-card">
							<button
								className="about-close"
								onClick={closeAbout}
								aria-label="Close"
							>
								<svg
									viewBox="0 0 16 16"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
								>
									<path
										d="M2 2l12 12M14 2L2 14"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
									/>
								</svg>
							</button>
							<div className="about-logo">
								<img
									src="/matcha_logo_dark.png"
									alt="Matcha"
									width="120"
									height="120"
								/>
							</div>
							<h1 className="about-name">Matcha</h1>
							<p className="about-version">Version 1.0.0</p>
							<button
								className="about-author-link"
								onClick={() => openUrl("https://github.com/alexshoe")}
							>
								Made by Alex Hsu
								<svg
									viewBox="0 0 16 16"
									fill="currentColor"
									width="14"
									height="14"
								>
									<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
								</svg>
							</button>
							<button
								className="about-bug-report-btn"
								onClick={() => {
									setViewBugsOpen(false);
									setBugReportOpen(true);
								}}
							>
								<FontAwesomeIcon
									icon={faBug}
									className="about-bug-report-icon"
								/>
								Report a Bug
							</button>
							{userRole === "Admin" && (
								<button
									className="about-bug-report-btn"
									onClick={() => {
										setBugReportOpen(false);
										setViewBugsOpen(true);
										fetchBugReports();
									}}
								>
									<FontAwesomeIcon
										icon={faEye}
										className="about-bug-report-icon"
									/>
									View Bug Reports
								</button>
							)}
						</div>

						<div className="bug-report-panel">
							<span className="bug-report-title">Report a Bug</span>
							<div className="bug-report-form">
								<div className="bug-report-field">
									<label className="bug-report-label">
										Brief description of the issue{" "}
										<span className="bug-report-required">*</span>
									</label>
									<input
										className={`bug-report-input${bugErrors.description ? " bug-report-input-error" : ""}`}
										type="text"
										value={bugDescription}
										onChange={(e) => {
											setBugDescription(e.target.value);
											if (bugErrors.description)
												setBugErrors((prev) => ({
													...prev,
													description: false,
												}));
										}}
										disabled={bugSubmitting}
									/>
									{bugErrors.description && (
										<span className="bug-report-error-text">
											This field is required
										</span>
									)}
								</div>
								<div className="bug-report-field">
									<label className="bug-report-label">
										Steps to reproduce the issue{" "}
										<span className="bug-report-required">*</span>
									</label>
									<span className="bug-report-hint">
										Please be as detailed as possible!
									</span>
									<textarea
										className={`bug-report-textarea${bugErrors.steps ? " bug-report-input-error" : ""}`}
										value={bugSteps}
										onChange={(e) => {
											setBugSteps(e.target.value);
											if (bugErrors.steps)
												setBugErrors((prev) => ({ ...prev, steps: false }));
										}}
										disabled={bugSubmitting}
										rows={5}
									/>
									{bugErrors.steps && (
										<span className="bug-report-error-text">
											This field is required
										</span>
									)}
								</div>
							</div>
							<button
								className="bug-report-submit-btn"
								onClick={submitBugReport}
								disabled={bugSubmitting}
							>
								{bugSubmitting ? (
									<span className="auth-btn-spinner" />
								) : (
									"Submit"
								)}
							</button>
						</div>

						<div className="view-bugs-panel">
							<span className="view-bugs-title">Bug Reports</span>
							{bugReportsLoading ? (
								<div className="view-bugs-loading">
									<span className="auth-btn-spinner" />
								</div>
							) : bugReports.length === 0 ? (
								<p className="view-bugs-empty">No bug reports yet.</p>
							) : (
								<div className="view-bugs-list">
									{bugReports.map((report) => {
										const key = `${report.user_id}-${report.created_at}`;
										const isExpanded = expandedBugId === key;
										return (
											<button
												key={key}
												className={`view-bugs-item${isExpanded ? " expanded" : ""}`}
												onClick={() =>
													setExpandedBugId(isExpanded ? null : key)
												}
											>
												<div className="view-bugs-item-header">
													<span className="view-bugs-item-desc">
														{report.description || "No description"}
													</span>
													<FontAwesomeIcon
														icon={faChevronDown}
														className={`view-bugs-item-chevron${isExpanded ? " open" : ""}`}
													/>
												</div>
												<div className="view-bugs-item-meta">
													<span>{report.display_name}</span>
													<span>
														{new Date(report.created_at).toLocaleDateString(
															"en-US",
															{
																month: "short",
																day: "numeric",
																year: "numeric",
															},
														)}
													</span>
												</div>
												{isExpanded && (
													<div className="view-bugs-item-details">
														<span className="view-bugs-detail-label">
															Steps to reproduce
														</span>
														<p className="view-bugs-detail-text">
															{report.steps || "—"}
														</p>
													</div>
												)}
											</button>
										);
									})}
								</div>
							)}
						</div>
					</div>
				</div>
			)}

			{accountOpen && (
				<div className="account-overlay" onClick={closeAccount}>
					<div
						className={`account-card-wrap${avatarPickerOpen ? " picker-open" : ""}`}
						onClick={(e) => e.stopPropagation()}
					>
						<div className="account-card">
							<button
								className="account-close"
								onClick={closeAccount}
								aria-label="Close"
							>
								<svg
									viewBox="0 0 16 16"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
								>
									<path
										d="M2 2l12 12M14 2L2 14"
										stroke="currentColor"
										strokeWidth="1.8"
										strokeLinecap="round"
									/>
								</svg>
							</button>
							<div className="account-header">
								<div
									className="account-avatar-large"
									role="button"
									onClick={() => {
										setPendingAvatarNum(avatarNum);
										setAvatarPickerOpen((v) => !v);
									}}
								>
									{avatarNum ? (
										<img
											src={`/avatars/avatar_${avatarNum}.png`}
											alt="Avatar"
											className="account-avatar-img"
										/>
									) : (
										avatarFallback
									)}
									<div className="account-avatar-hover-overlay">
										<FontAwesomeIcon
											icon={faPencil}
											className="account-avatar-hover-icon"
										/>
										<span className="account-avatar-hover-text">
											Choose
											<br />
											avatar
										</span>
									</div>
								</div>
								<span className="account-display-name">{displayName}</span>
								<span className="account-email">{user?.email ?? "—"}</span>
							</div>
							<div className="account-body">
								<span className="account-section-label">Account</span>
								<div className="account-row">
									<span className="account-row-label">Display name</span>
									<span className="account-row-value">{displayName}</span>
								</div>
								{editingDisplayName ? (
									<div className="account-password-edit">
										<input
											className="account-password-input"
											placeholder="Enter new display name"
											value={displayNameValue}
											onChange={(e) => setDisplayNameValue(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter")
													saveDisplayName(displayNameValue);
												else if (e.key === "Escape") {
													setDisplayNameValue(displayName);
													setEditingDisplayName(false);
												}
											}}
											autoFocus
										/>
										<div className="account-password-actions">
											<button
												className="account-change-password-btn"
												onClick={() => {
													setDisplayNameValue(displayName);
													setEditingDisplayName(false);
												}}
											>
												Cancel
											</button>
											<button
												className="account-change-password-btn account-save-btn"
												onClick={() => saveDisplayName(displayNameValue)}
											>
												Save
											</button>
										</div>
									</div>
								) : (
									<div className="account-row account-row-end">
										<button
											className="account-change-password-btn"
											onClick={() => {
												setDisplayNameValue("");
												setEditingDisplayName(true);
											}}
										>
											Change display name
										</button>
									</div>
								)}
								<div className="account-row">
									<span className="account-row-label">Email</span>
									<span className="account-row-value">
										{user?.email ?? "—"}
									</span>
								</div>
								<div className="account-row">
									<span className="account-row-label">Password</span>
									{editingPassword ? null : (
										<span className="account-row-value">••••••••••</span>
									)}
								</div>
								{editingPassword ? (
									<div className="account-password-edit">
										<div className="account-password-input-wrapper">
											<input
												className="account-password-input"
												type={showNewPassword ? "text" : "password"}
												placeholder="New password"
												value={newPassword}
												onChange={(e) => {
													setNewPassword(e.target.value);
													setPasswordError(null);
												}}
												onKeyDown={(e) =>
													e.key === "Enter" && handlePasswordSave()
												}
												disabled={passwordSaving}
												autoFocus
											/>
											<button
												className="account-password-toggle"
												onClick={() => setShowNewPassword((v) => !v)}
												tabIndex={-1}
												title="Reveal"
												aria-label={
													showNewPassword ? "Hide password" : "Reveal password"
												}
												disabled={passwordSaving}
											>
												{showNewPassword ? (
													<svg
														viewBox="0 0 20 20"
														fill="none"
														xmlns="http://www.w3.org/2000/svg"
														width="13"
														height="13"
													>
														<path
															d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"
															stroke="currentColor"
															strokeWidth="1.5"
															strokeLinejoin="round"
														/>
														<circle
															cx="10"
															cy="10"
															r="2.5"
															stroke="currentColor"
															strokeWidth="1.5"
														/>
													</svg>
												) : (
													<svg
														viewBox="0 0 20 20"
														fill="none"
														xmlns="http://www.w3.org/2000/svg"
														width="13"
														height="13"
													>
														<path
															d="M3 3l14 14M8.5 8.6A2.5 2.5 0 0012.4 12.5M6.3 6.4C4.3 7.6 2.9 9.3 2 10c1.5 2.5 4.5 6 8 6 1.5 0 2.9-.5 4.1-1.3M10 4c3.5 0 6.5 3.5 8 6-.5.9-1.2 1.9-2.1 2.7"
															stroke="currentColor"
															strokeWidth="1.5"
															strokeLinecap="round"
															strokeLinejoin="round"
														/>
													</svg>
												)}
											</button>
										</div>
										<div className="account-password-input-wrapper">
											<input
												className="account-password-input"
												type={showConfirmPassword ? "text" : "password"}
												placeholder="Confirm new password"
												value={confirmPassword}
												onChange={(e) => {
													setConfirmPassword(e.target.value);
													setPasswordError(null);
												}}
												onKeyDown={(e) =>
													e.key === "Enter" && handlePasswordSave()
												}
												disabled={passwordSaving}
											/>
											<button
												className="account-password-toggle"
												onClick={() => setShowConfirmPassword((v) => !v)}
												tabIndex={-1}
												title="Reveal"
												aria-label={
													showConfirmPassword
														? "Hide password"
														: "Reveal password"
												}
												disabled={passwordSaving}
											>
												{showConfirmPassword ? (
													<svg
														viewBox="0 0 20 20"
														fill="none"
														xmlns="http://www.w3.org/2000/svg"
														width="13"
														height="13"
													>
														<path
															d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z"
															stroke="currentColor"
															strokeWidth="1.5"
															strokeLinejoin="round"
														/>
														<circle
															cx="10"
															cy="10"
															r="2.5"
															stroke="currentColor"
															strokeWidth="1.5"
														/>
													</svg>
												) : (
													<svg
														viewBox="0 0 20 20"
														fill="none"
														xmlns="http://www.w3.org/2000/svg"
														width="13"
														height="13"
													>
														<path
															d="M3 3l14 14M8.5 8.6A2.5 2.5 0 0012.4 12.5M6.3 6.4C4.3 7.6 2.9 9.3 2 10c1.5 2.5 4.5 6 8 6 1.5 0 2.9-.5 4.1-1.3M10 4c3.5 0 6.5 3.5 8 6-.5.9-1.2 1.9-2.1 2.7"
															stroke="currentColor"
															strokeWidth="1.5"
															strokeLinecap="round"
															strokeLinejoin="round"
														/>
													</svg>
												)}
											</button>
										</div>
										{passwordError && (
											<p className="account-password-error">{passwordError}</p>
										)}
										<div className="account-password-actions">
											<button
												className="account-change-password-btn"
												onClick={() => {
													setEditingPassword(false);
													setNewPassword("");
													setConfirmPassword("");
													setPasswordError(null);
													setShowNewPassword(false);
													setShowConfirmPassword(false);
												}}
												disabled={passwordSaving}
											>
												Cancel
											</button>
											<button
												className="account-change-password-btn account-save-btn"
												onClick={handlePasswordSave}
												disabled={passwordSaving}
											>
												{passwordSaving ? "Saving…" : "Save"}
											</button>
										</div>
									</div>
								) : (
									<div className="account-row account-row-end">
										<button
											className="account-change-password-btn"
											onClick={() => setEditingPassword(true)}
										>
											Change password
										</button>
									</div>
								)}
								<div className="account-divider" />
								<span className="account-section-label">Sync</span>
								<div className="account-row">
									<span className="account-row-label">Storage used</span>
									<span className="account-row-value">{storageUsedLabel}</span>
								</div>
								<div className="account-divider" />
								<div className="account-signout-row">
									<button
										className="account-signout-btn"
										onClick={async () => {
											if (activeSupabase.current) {
												await activeSupabase.current.auth.signOut();
											}
											activeSupabase.current = null;
											setUser(null);
											setAccountOpen(false);
											setIsAuthenticated(false);
										}}
									>
										Sign out
									</button>
								</div>
							</div>
						</div>

						<div className="avatar-picker-panel">
							<span className="avatar-picker-title">Choose Avatar</span>
							<div className="avatar-picker-grid">
								{Array.from({ length: TOTAL_AVATARS }, (_, i) => i + 1).map(
									(num) => (
										<button
											key={num}
											className={`avatar-picker-option${pendingAvatarNum === num ? " selected" : ""}`}
											onClick={() => setPendingAvatarNum(num)}
										>
											<img
												src={`/avatars/avatar_${num}.png`}
												alt={`Avatar ${num}`}
											/>
										</button>
									),
								)}
							</div>
							<button
								className="avatar-picker-save-btn"
								disabled={pendingAvatarNum === null}
								onClick={() => pendingAvatarNum && saveAvatar(pendingAvatarNum)}
							>
								Save
							</button>
						</div>
					</div>
				</div>
			)}

			{settingsOpen && (
				<div
					className="settings-overlay"
					onClick={() => setSettingsOpen(false)}
				>
					<div className="settings-card" onClick={(e) => e.stopPropagation()}>
						<button
							className="settings-close"
							onClick={() => setSettingsOpen(false)}
							aria-label="Close"
						>
							<svg
								viewBox="0 0 16 16"
								fill="none"
								xmlns="http://www.w3.org/2000/svg"
								width="14"
								height="14"
							>
								<path
									d="M2 2l12 12M14 2L2 14"
									stroke="currentColor"
									strokeWidth="1.8"
									strokeLinecap="round"
								/>
							</svg>
						</button>
						<div className="settings-header">
							<FontAwesomeIcon icon={faGear} className="settings-header-icon" />
							<span className="settings-header-title">Settings</span>
						</div>
						<div className="settings-body">
							<div className="settings-row">
								<span className="settings-row-label">Sort notes by</span>
								<select
									className="settings-select"
									value={sortNotesBy}
									onChange={(e) => {
										const val = e.target.value as SortNotesBy;
										setSortNotesBy(val);
										localStorage.setItem("matcha_sortNotesBy", val);
									}}
								>
									<option value="date_edited">Date Edited</option>
									<option value="date_created">Date Created</option>
									<option value="title">Title</option>
								</select>
							</div>
							<div className="settings-row">
								<span className="settings-row-label">New notes start with</span>
								<select
									className="settings-select"
									value={newNoteStartWith}
									onChange={(e) => {
										const val = e.target.value as NewNoteStart;
										setNewNoteStartWith(val);
										localStorage.setItem("matcha_newNoteStartWith", val);
									}}
								>
									<option value="title">Title</option>
									<option value="heading">Heading</option>
									<option value="subheading">Subheading</option>
									<option value="body">Body</option>
								</select>
							</div>
							<div className="settings-divider" />
							<label className="settings-checkbox-row">
								<div className="settings-checkbox-text">
									<span className="settings-checkbox-label">
										Automatically sort checked items
									</span>
									<span className="settings-checkbox-desc">
										Automatically move checklist items to the bottom of the list
										as they are checked.
									</span>
								</div>
								<input
									type="checkbox"
									className="settings-checkbox-input"
									checked={autoSortChecked}
									onChange={(e) => {
										setAutoSortChecked(e.target.checked);
										localStorage.setItem(
											"matcha_autoSortChecked",
											String(e.target.checked),
										);
									}}
								/>
								<span className="settings-checkbox-circle" />
							</label>
							<div className="settings-divider" />
							<div className="settings-appearance-section">
								<span className="settings-row-label">Appearance</span>
								<div className="settings-theme-cards">
									{(["dark", "matcha", "light"] as const).map((t) => (
										<button
											key={t}
											className={`settings-theme-card${theme === t ? " settings-theme-card-active" : ""}`}
											onClick={() => setTheme(t)}
										>
											<div className={`stp stp-${t}`}>
												<div className="stp-sidebar-area">
													<div className="stp-item stp-item-active" />
													<div className="stp-item" />
													<div className="stp-item" />
												</div>
												<div className="stp-main-area">
													<div className="stp-title-line" />
													<div className="stp-body-line" />
													<div className="stp-body-line stp-body-line-short" />
													<div className="stp-body-line" />
												</div>
											</div>
											<span className="settings-theme-card-label">
												{t === "dark"
													? "Dark"
													: t === "matcha"
														? "Matcha"
														: "Light"}
											</span>
											<div
												className={`settings-theme-indicator${theme === t ? " settings-theme-indicator-active" : ""}`}
											>
												{theme === t && (
													<svg
														viewBox="0 0 24 24"
														fill="none"
														width="12"
														height="12"
													>
														<path
															d="M5 12l5 5 9-9"
															stroke="white"
															strokeWidth="2.5"
															strokeLinecap="round"
															strokeLinejoin="round"
														/>
													</svg>
												)}
											</div>
										</button>
									))}
								</div>
							</div>
						</div>
					</div>
				</div>
			)}

			{manageListsOpen && (
				<div className="manage-lists-overlay" onClick={closeManageLists}>
					<div
						className="manage-lists-card"
						onClick={(e) => e.stopPropagation()}
					>
						<button
							className="manage-lists-close"
							onClick={closeManageLists}
							aria-label="Close"
						>
							<svg
								viewBox="0 0 16 16"
								fill="none"
								xmlns="http://www.w3.org/2000/svg"
								width="14"
								height="14"
							>
								<path
									d="M2 2l12 12M14 2L2 14"
									stroke="currentColor"
									strokeWidth="1.8"
									strokeLinecap="round"
								/>
							</svg>
						</button>
						<div className="manage-lists-header">
							<FontAwesomeIcon
								icon={faFolder}
								className="manage-lists-header-icon"
							/>
							<span className="manage-lists-header-title">Manage Lists</span>
						</div>
						<div className="manage-lists-body">
							<div className="manage-lists-items">
								{noteLists.map((name, idx) => (
									<div
										key={idx}
										className={`manage-lists-row${activeFolder === name ? " active" : ""}`}
									>
										{renamingListIdx === idx ? (
											<input
												ref={renameListInputRef}
												className="manage-lists-rename-input"
												value={renameListValue}
												onChange={(e) => setRenameListValue(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter")
														finishRenameList(idx, renameListValue);
													else if (e.key === "Escape") setRenamingListIdx(null);
												}}
												onBlur={() => finishRenameList(idx, renameListValue)}
											/>
										) : (
											<>
												<FontAwesomeIcon
													icon={faFolder}
													className="manage-lists-row-icon"
												/>
												<span className="manage-lists-row-name">{name}</span>
												<div className="manage-lists-row-actions">
													<button
														className="manage-lists-row-btn"
														title="Rename"
														onClick={() => {
															setRenamingListIdx(idx);
															setRenameListValue(name);
														}}
													>
														<FontAwesomeIcon icon={faPen} />
													</button>
													{noteLists.length > 1 && (
														<button
															className="manage-lists-row-btn manage-lists-row-btn-danger"
															title="Delete"
															onClick={() => removeList(idx)}
														>
															<FontAwesomeIcon icon={faTrash} />
														</button>
													)}
												</div>
											</>
										)}
									</div>
								))}
							</div>
							<div className="manage-lists-divider" />
							<div className="manage-lists-add-row">
								<input
									ref={newListInputRef}
									className="manage-lists-add-input"
									placeholder="New list name…"
									value={newListName}
									onChange={(e) => setNewListName(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") addList(newListName);
									}}
								/>
								<button
									className="manage-lists-add-btn"
									disabled={
										!newListName.trim() ||
										noteLists.includes(newListName.trim())
									}
									onClick={() => addList(newListName)}
								>
									<FontAwesomeIcon icon={faPlus} />
									<span>Add</span>
								</button>
							</div>
						</div>
					</div>
				</div>
			)}

			{contextMenu && (
				<ul
					className="context-menu"
					style={{ top: contextMenu.y, left: contextMenu.x }}
					onClick={(e) => e.stopPropagation()}
				>
					{isRecentlyDeleted ? (
						<>
							<li
								className="context-menu-item"
								onClick={() => {
									restoreNote(contextMenu.noteId);
									setContextMenu(null);
								}}
							>
								Restore Note
							</li>
							<li className="context-menu-separator" />
							<li
								className="context-menu-item context-menu-item-danger"
								onClick={() => {
									permanentDeleteNote(contextMenu.noteId);
									setContextMenu(null);
								}}
							>
								Delete Permanently
							</li>
						</>
					) : (
						<>
							<li
								className={`context-menu-item${selectedNoteIsEmpty ? " context-menu-item-disabled" : ""}`}
								onClick={() => {
									if (selectedNoteIsEmpty) return;
									createNote();
									setContextMenu(null);
								}}
							>
								New Note
							</li>
							<li
								className="context-menu-item"
								onClick={() => {
									duplicateNote(contextMenu.noteId);
									setContextMenu(null);
								}}
							>
								Duplicate
							</li>
							<li
								className="context-menu-item"
								onClick={() => {
									const note = notes.find((n) => n.id === contextMenu.noteId);
									const { title } = extractPreview(note?.content ?? "");
									setRenameValue(title || "");
									setRenamingId(contextMenu.noteId);
									setSelectedId(contextMenu.noteId);
									setContextMenu(null);
								}}
							>
								Rename
							</li>
							<li
								className="context-menu-item"
								onClick={() => {
									const note = notes.find((n) => n.id === contextMenu.noteId);
									pinNote(contextMenu.noteId, !note?.pinned);
									setContextMenu(null);
								}}
							>
								{notes.find((n) => n.id === contextMenu.noteId)?.pinned
									? "Unpin Note"
									: "Pin Note"}
							</li>
							<li className="context-menu-separator" />
							<li
								className="context-menu-item context-menu-item-danger"
								onClick={() => {
									softDeleteNote(contextMenu.noteId);
									setContextMenu(null);
								}}
							>
								Delete
							</li>
						</>
					)}
				</ul>
			)}
			{toastMessage && (
				<div className="toast-container">
					<div className={`toast${toastIsError ? " toast-error" : ""}`}>
						{toastMessage}
					</div>
				</div>
			)}
		</div>
	);
}

export default App;
