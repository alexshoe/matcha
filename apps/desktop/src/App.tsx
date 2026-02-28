import React, {
	useState,
	useEffect,
	useLayoutEffect,
	useCallback,
	useMemo,
	useRef,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { NoteEditor } from "./components/NoteEditor";
import { AboutModal } from "./components/modals/AboutModal";
import {
	Alert,
	TodoList,
	AuthPage,
	Sidebar,
	SettingsModal,
	AccountModal,
	ShareNoteModal,
} from "@matcha/ui";
import {
	supabase,
	deleteAllNoteImages,
	deleteAllNoteFiles,
	extractPreview,
	extractAllText,
	isNoteEmpty,
	formatBytes,
} from "@matcha/core";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type {
	Note,
	SortNotesBy,
	NewNoteStart,
	SharedNoteEntry,
} from "@matcha/core";
import "@matcha/ui/styles";

function App() {
	// ── Auth state ──
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [sessionChecked, setSessionChecked] = useState(!supabase);
	const [user, setUser] = useState<User | null>(null);
	const activeSupabase = useRef<SupabaseClient | null>(null);

	// ── Notes state ──
	const [notes, setNotes] = useState<Note[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
	const selectionAnchorId = useRef<string | null>(null);
	const shouldAutoFocusEditor = useRef(true);
	const pendingNoteIds = useRef(new Set<string>());
	const latestEditorContent = useRef<{ id: string; content: string } | null>(
		null,
	);
	const recentlyCleanedUpIds = useRef(new Set<string>());
	const cloudSyncAttempted = useRef(false);
	const isFirstRun = useRef(false);
	const lastSentVersions = useRef<Map<string, number>>(new Map());

	// ── Sidebar / UI state ──
	const [sidebarWidth, setSidebarWidth] = useState(240);
	const [pinnedExpanded, setPinnedExpanded] = useState(true);
	const [sidebarFocused, setSidebarFocused] = useState(false);
	const [showTodoList, setShowTodoList] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const searchInputRef = useRef<HTMLInputElement>(null);
	const noteListRef = useRef<HTMLDivElement>(null);
	const isResizing = useRef(false);
	const startX = useRef(0);
	const startWidth = useRef(0);

	// ── Rename state ──
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const renameInputRef = useRef<HTMLInputElement>(null);

	// ── Context menu ──
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		noteId: string;
	} | null>(null);

	// ── Modal open flags ──
	const [aboutOpen, setAboutOpen] = useState(false);
	const [accountOpen, setAccountOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);

	// ── Settings ──
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

	// ── Account / profile ──
	const [displayName, setDisplayName] = useState("User");
	const [avatarNum, setAvatarNum] = useState<number | null>(null);
	const [userRole, setUserRole] = useState<string>("User");
	const [storageUsedLabel, setStorageUsedLabel] = useState("–");

	// ── Folder state ──
	const [activeFolder, setActiveFolder] = useState<string>(
		() => localStorage.getItem("matcha_activeList") || "My Notes",
	);

	// ── Toast ──
	const [toastMessage, setToastMessage] = useState<string | null>(null);
	const [toastIsError, setToastIsError] = useState(false);
	const [toastIsShared, setToastIsShared] = useState(false);
	const [toastSharedNoteId, setToastSharedNoteId] = useState<string | null>(null);

	// ── Realtime todo sync ──
	const [todoExternalUpdate, setTodoExternalUpdate] = useState<{
		goals: { id: string; text: string; checked: boolean }[];
		tasks: Record<string, { id: string; text: string; checked: boolean }[]>;
	} | null>(null);

	// ── Shared notes ──
	const [sharedNoteCreator, setSharedNoteCreator] = useState<string | null>(
		null,
	);
	const [sharedNotes, setSharedNotes] = useState<SharedNoteEntry[]>([]);
	const [sharedNotesLoading, setSharedNotesLoading] = useState(false);
	const [shareModalNoteId, setShareModalNoteId] = useState<string | null>(null);
	const [leaveConfirmNoteId, setLeaveConfirmNoteId] = useState<string | null>(
		null,
	);

	// ── Animation ref ──
	const prevNoteRects = useRef<Map<string, DOMRect>>(new Map());

	const SIDEBAR_MIN = 240;
	const SIDEBAR_MAX = 480;

	// ── Resize handler ──
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

	// ── Effects ──

	useEffect(() => {
		document.documentElement.classList.add(`os-${platform()}`);
	}, []);

	// Prevent browser from navigating to dropped files (fullscreen takeover)
	useEffect(() => {
		const preventDrag = (e: DragEvent) => e.preventDefault();
		document.addEventListener("dragover", preventDrag);
		document.addEventListener("drop", preventDrag);
		return () => {
			document.removeEventListener("dragover", preventDrag);
			document.removeEventListener("drop", preventDrag);
		};
	}, []);

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		localStorage.setItem("matcha_theme", theme);
	}, [theme]);

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
			if (aboutOpen) setAboutOpen(false);
			else if (accountOpen) setAccountOpen(false);
			else if (settingsOpen) setSettingsOpen(false);
		};
		if (aboutOpen || accountOpen || settingsOpen) {
			window.addEventListener("keydown", onKey);
			return () => window.removeEventListener("keydown", onKey);
		}
	}, [aboutOpen, accountOpen, settingsOpen]);

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
		if (renamingId && renameInputRef.current) {
			renameInputRef.current.focus();
			renameInputRef.current.select();
		}
	}, [renamingId]);

	useEffect(() => {
		if (user) {
			const name =
				user.user_metadata?.display_name || user.user_metadata?.full_name || "";
			if (name) {
				setDisplayName(name);
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

		function computeLocal() {
			const enc = new TextEncoder();
			return notes.reduce((sum, n) => sum + enc.encode(n.content).length, 0);
		}

		if (!db || !user) {
			setStorageUsedLabel(formatBytes(computeLocal()));
			return;
		}

		db.rpc("get_storage_used_bytes").then(({ data, error: rpcErr }) => {
			if (rpcErr || data === null) {
				setStorageUsedLabel(formatBytes(computeLocal()));
				return;
			}
			setStorageUsedLabel(formatBytes(data as number));
		});
	}, [accountOpen, user, notes]);

	const fetchSharedNotes = useCallback(async () => {
		const db = activeSupabase.current;
		if (!db || !user) return;
		setSharedNotesLoading(true);

		const [sharedWithMe, sharedByMe] = await Promise.all([
			db
				.from("note_sharing")
				.select(
					"note_id, notes(*), users!note_sharing_owner_id_fkey(display_name, avatar_num)",
				)
				.eq("shared_with_id", user.id),
			db
				.from("note_sharing")
				.select(
					"note_id, shared_with_id, users!note_sharing_shared_with_id_fkey(display_name)",
				)
				.eq("owner_id", user.id),
		]);

		const ownDisplayName = displayName;
		const entries = new Map<string, SharedNoteEntry>();

		for (const row of sharedWithMe.data ?? []) {
			const note = row.notes as unknown as Record<string, unknown> | null;
			if (!note || note.deleted) continue;
			const owner = row.users as unknown as Record<string, unknown> | null;
			entries.set(note.id as string, {
				id: note.id as string,
				content: note.content as string,
				created_at: note.created_at as number,
				updated_at: note.updated_at as number,
				pinned: note.pinned as boolean,
				list: note.list as string,
				deleted: note.deleted as boolean,
				deleted_at: (note.deleted_at as number | null) ?? null,
				version_num: (note.version_num as number) ?? 1,
				owner_display_name: (owner?.display_name as string) ?? "Unknown",
				owner_avatar_num: (owner?.avatar_num as number | null) ?? null,
				is_own: false,
			});
		}

		const mySharedNoteIds = new Map<string, string[]>();
		for (const row of sharedByMe.data ?? []) {
			const recipient = row.users as unknown as Record<string, unknown> | null;
			if (!recipient?.display_name) continue;
			const names = mySharedNoteIds.get(row.note_id) ?? [];
			names.push(recipient.display_name as string);
			mySharedNoteIds.set(row.note_id, names);
		}

		if (mySharedNoteIds.size > 0) {
			const noteIds = [...mySharedNoteIds.keys()];
			const { data: myNotes } = await db
				.from("notes")
				.select("*")
				.in("id", noteIds)
				.eq("deleted", false);

			for (const note of myNotes ?? []) {
				if (!entries.has(note.id)) {
					entries.set(note.id, {
						...note,
						owner_display_name: ownDisplayName,
						owner_avatar_num: null,
						is_own: true,
						shared_with_names: mySharedNoteIds.get(note.id),
					});
				} else {
					const existing = entries.get(note.id);
					if (existing) {
						existing.is_own = true;
						existing.shared_with_names = mySharedNoteIds.get(note.id);
					}
				}
			}
		}

		const result = [...entries.values()].sort(
			(a, b) => b.updated_at - a.updated_at,
		);

		// ── New shared note detection ──
		const notesSharedWithMe = result.filter((n) => !n.is_own);
		const seenKey = `matcha_seen_shared_note_ids_${user.id}`;
		const seenRaw = localStorage.getItem(seenKey);
		if (seenRaw !== null) {
			const seenIds = new Set(JSON.parse(seenRaw) as string[]);
			const newNotes = notesSharedWithMe.filter((n) => !seenIds.has(n.id));
			if (newNotes.length === 1) {
				setToastIsError(false);
				setToastIsShared(true);
				setToastSharedNoteId(newNotes[0].id);
				setToastMessage(`New shared note from ${newNotes[0].owner_display_name}`);
				setTimeout(() => setToastMessage(null), 3500);
			} else if (newNotes.length > 1) {
				setToastIsError(false);
				setToastIsShared(true);
				setToastSharedNoteId(null);
				setToastMessage(`${newNotes.length} new shared notes`);
				setTimeout(() => setToastMessage(null), 3500);
			}
		}
		localStorage.setItem(seenKey, JSON.stringify(notesSharedWithMe.map((n) => n.id)));

		setSharedNotes(result);
		setSharedNotesLoading(false);
		return result;
	}, [user, displayName]);

	useEffect(() => {
		if (activeFolder === "Shared Notes") {
			fetchSharedNotes().then((result) => {
				if (result && result.length > 0) {
					setSelectedId(result[0].id);
					setSelectedNoteIds([result[0].id]);
				}
			});
		} else {
			setSharedNotes([]);
		}
	}, [activeFolder, fetchSharedNotes]);

	useEffect(() => {
		if (activeFolder !== "Shared Notes" || !selectedId) {
			setSharedNoteCreator(null);
			return;
		}
		const shared = sharedNotes.find((n) => n.id === selectedId);
		if (shared && !shared.is_own) {
			setSharedNoteCreator(shared.owner_display_name);
		} else if (shared?.is_own && shared.shared_with_names?.length) {
			setSharedNoteCreator(`You → ${shared.shared_with_names.join(", ")}`);
		} else {
			setSharedNoteCreator(null);
		}
	}, [selectedId, activeFolder, sharedNotes]);

	useEffect(() => {
		invoke<boolean>("check_first_run")
			.then((firstRun) => {
				isFirstRun.current = firstRun;
				return invoke<Note[]>("get_notes");
			})
			.then((loaded) => {
				const sorted = [...loaded].sort((a, b) => b.updated_at - a.updated_at);
				setNotes(sorted);

				const folder =
					localStorage.getItem("matcha_activeList") || activeFolder;
				const inList =
					folder === "Recently Deleted"
						? sorted.filter((n) => n.deleted)
						: sorted.filter((n) => n.list === folder && !n.deleted);
				if (inList.length > 0) {
					setSelectedId(inList[0].id);
					setSelectedNoteIds([inList[0].id]);
				}
			})
			.finally(() => setLoading(false));

		const client = supabase;
		if (client) {
			client.auth.getUser().then(({ data: { user: serverUser }, error }) => {
				if (serverUser && !error) {
					activeSupabase.current = client;
					setUser(serverUser);
					setIsAuthenticated(true);
				} else {
					client.auth.signOut();
					// No user session — if this is a first run, mark initialized now
					// (cloud sync won't run without a user, so nothing to pull)
					if (isFirstRun.current) {
						isFirstRun.current = false;
						invoke("mark_initialized").catch((e: unknown) =>
							console.warn("Failed to mark initialized:", e),
						);
					}
				}
				setSessionChecked(true);
			});

			const {
				data: { subscription },
			} = client.auth.onAuthStateChange((event, session) => {
				if (event === "SIGNED_OUT" || !session) {
					activeSupabase.current = null;
					setUser(null);
					setIsAuthenticated(false);
					cloudSyncAttempted.current = false;
					// Clear local notes so the next user doesn't see this account's data
					setNotes([]);
					setSelectedId(null);
					setSelectedNoteIds([]);
					invoke("set_notes", { notes: [] }).catch(() => {});
				} else if (session?.user) {
					activeSupabase.current = client;
					setUser(session.user);
				}
			});

			return () => subscription.unsubscribe();
		}
	}, []);

	const performCloudSync = useCallback(async () => {
		const db = activeSupabase.current;
		if (!db || !user) return;

		const firstRun = isFirstRun.current;

		const { data, error } = await db
			.from("notes")
			.select("*")
			.eq("user_id", user.id);

		if (error || !data) return;

		const cloudNotes: Note[] = data.map((n: Record<string, unknown>) => ({
			id: n.id as string,
			content: (n.content as string) || "",
			created_at: n.created_at as number,
			updated_at: n.updated_at as number,
			pinned: (n.pinned as boolean) ?? false,
			list: (n.list as string) || "My Notes",
			deleted: (n.deleted as boolean) ?? false,
			deleted_at: (n.deleted_at as number | null) ?? null,
			version_num: (n.version_num as number) ?? 1,
		}));

		setNotes((prev) => {
			// On first run (fresh install/reinstall), cloud takes priority —
			// don't push any local-only notes to cloud since they're stale.
			if (firstRun) {
				const sorted = [...cloudNotes].sort(
					(a, b) => b.updated_at - a.updated_at,
				);
				invoke("set_notes", { notes: sorted });
				return sorted;
			}

			const localMap = new Map(prev.map((n) => [n.id, n]));
			const cloudMap = new Map(cloudNotes.map((n) => [n.id, n]));

			const merged = new Map(localMap);
			for (const [id, cloudNote] of cloudMap) {
				const local = localMap.get(id);
				if (!local) {
					merged.set(id, cloudNote);
				} else if (cloudNote.deleted !== local.deleted) {
					merged.set(id, {
						...(cloudNote.updated_at >= local.updated_at ? cloudNote : local),
						deleted: cloudNote.deleted,
						deleted_at: cloudNote.deleted_at,
					});
				} else if (cloudNote.updated_at > local.updated_at) {
					merged.set(id, cloudNote);
				} else if (
					cloudNote.updated_at === local.updated_at &&
					cloudNote.version_num > local.version_num
				) {
					merged.set(id, cloudNote);
				}
			}

			for (const [id, local] of localMap) {
				if (!cloudMap.has(id)) {
					db.from("notes")
						.upsert({
							id: local.id,
							user_id: user.id,
							content: local.content,
							list: local.list,
							pinned: local.pinned,
							deleted: local.deleted,
							deleted_at: local.deleted_at,
							created_at: local.created_at,
							updated_at: local.updated_at,
							version_num: local.version_num,
						})
						.then(({ error: e }) => {
							if (e) console.warn("Supabase push error:", e.message);
						});
				}
			}

			const sorted = [...merged.values()].sort(
				(a, b) => b.updated_at - a.updated_at,
			);
			invoke("set_notes", { notes: sorted });
			return sorted;
		});

		// Mark as initialized after successful first-run sync
		if (firstRun) {
			isFirstRun.current = false;
			invoke("mark_initialized").catch((e: unknown) =>
				console.warn("Failed to mark initialized:", e),
			);
		}

		fetchSharedNotes();
	}, [user, fetchSharedNotes]);

	const handleSync = useCallback(async () => {
		await performCloudSync();
	}, [performCloudSync]);

	useEffect(() => {
		if (!isAuthenticated || loading || cloudSyncAttempted.current) return;
		cloudSyncAttempted.current = true;
		handleSync();
	}, [isAuthenticated, loading, handleSync]);

	// ── Helper: map a Supabase record to a local Note ──
	function mapCloudNote(record: Record<string, unknown>): Note {
		return {
			id: record.id as string,
			content: (record.content as string) || "",
			created_at: record.created_at as number,
			updated_at: record.updated_at as number,
			pinned: (record.pinned as boolean) ?? false,
			list: (record.list as string) || "My Notes",
			deleted: (record.deleted as boolean) ?? false,
			deleted_at: (record.deleted_at as number | null) ?? null,
			version_num: (record.version_num as number) ?? 1,
		};
	}

	// ── Supabase Realtime subscriptions ──
	useEffect(() => {
		const db = activeSupabase.current;
		if (!db || !user) return;

		// Notes channel — broad subscription, client-side filter
		const notesChannel = db
			.channel("notes-realtime")
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "notes" },
				(payload) => {
					const record = payload.new as Record<string, unknown> | null;
					if (!record?.id) return;

					if (payload.eventType === "INSERT") {
						const mapped = mapCloudNote(record);
						setNotes((prev) => {
							if (prev.some((n) => n.id === mapped.id)) return prev;
							const next = [...prev, mapped].sort(
								(a, b) => b.updated_at - a.updated_at,
							);
							invoke("set_notes", { notes: next });
							return next;
						});
					} else if (payload.eventType === "UPDATE") {
						const mapped = mapCloudNote(record);

						// Update own notes
						setNotes((prev) => {
							const existing = prev.find((n) => n.id === mapped.id);
							if (!existing || mapped.version_num <= existing.version_num)
								return prev;
							const next = prev
								.map((n) => (n.id === mapped.id ? mapped : n))
								.sort((a, b) => b.updated_at - a.updated_at);
							invoke("set_notes", { notes: next });
							return next;
						});

						// Update shared notes
						setSharedNotes((prev) =>
							prev
								.map((n) =>
									n.id === mapped.id &&
									mapped.version_num > (n.version_num ?? 0)
										? { ...n, ...mapped }
										: n,
								)
								.sort((a, b) => b.updated_at - a.updated_at),
						);

						// Only show toast if this wasn't our own save
						const lastSent = lastSentVersions.current.get(mapped.id);
						if (lastSent === undefined || mapped.version_num > lastSent) {
							setNotes((prev) => {
								const current = prev.find((n) => n.id === mapped.id);
								if (current && current.id === selectedId) {
									showToast("Note updated on another device", false);
								}
								return prev;
							});
						}
					} else if (payload.eventType === "DELETE") {
						const oldRecord = payload.old as Record<string, unknown> | null;
						const deletedId = (oldRecord?.id as string) ?? null;
						if (deletedId) {
							setNotes((prev) => {
								const next = prev.filter((n) => n.id !== deletedId);
								invoke("set_notes", { notes: next });
								return next;
							});
						}
					}
				},
			)
			.subscribe();

		// Note sharing channel — re-fetch shared notes on any change
		const sharingChannel = db
			.channel("sharing-realtime")
			.on(
				"postgres_changes",
				{ event: "*", schema: "public", table: "note_sharing" },
				() => {
					fetchSharedNotes();
				},
			)
			.subscribe();

		// Todo channel — filtered to own user
		const todoChannel = db
			.channel("todo-realtime")
			.on(
				"postgres_changes",
				{
					event: "*",
					schema: "public",
					table: "to_do_list",
					filter: `user_id=eq.${user.id}`,
				},
				(payload) => {
					const record = payload.new as Record<string, unknown> | null;
					if (!record) return;
					try {
						const goals = JSON.parse(
							(record.long_term_goals as string) || "[]",
						);
						const tasks = JSON.parse((record.to_do_list as string) || "{}");
						setTodoExternalUpdate({ goals, tasks });
					} catch {
						// ignore malformed payloads
					}
				},
			)
			.subscribe();

		return () => {
			db.removeChannel(notesChannel);
			db.removeChannel(sharingChannel);
			db.removeChannel(todoChannel);
		};
	}, [user, selectedId, fetchSharedNotes]);

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

	// ── Toast helper ──

	function showToast(message: string, isError: boolean) {
		setToastIsError(isError);
		setToastIsShared(false);
		setToastMessage(message);
		setTimeout(() => setToastMessage(null), 3500);
	}

	// ── Note CRUD ──

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
						pinned: updated.pinned,
						created_at: updated.created_at,
						updated_at: updated.updated_at,
						version_num: updated.version_num,
					})
					.then(({ error }) => {
						if (error) console.warn("Supabase sync error:", error.message);
					});
				lastSentVersions.current.set(updated.id, updated.version_num);
			}
		},
		[user],
	);

	const saveSharedNote = useCallback(
		async (id: string, content: string) => {
			const db = activeSupabase.current;
			if (!db) return;
			const now = Math.floor(Date.now() / 1000);
			const sharedNote = sharedNotes.find((n) => n.id === id);
			const newVersion = (sharedNote?.version_num ?? 0) + 1;
			await db
				.from("notes")
				.update({ content, updated_at: now, version_num: newVersion })
				.eq("id", id);
			setSharedNotes((prev) =>
				prev
					.map((n) =>
						n.id === id
							? { ...n, content, updated_at: now, version_num: newVersion }
							: n,
					)
					.sort((a, b) => b.updated_at - a.updated_at),
			);
			lastSentVersions.current.set(id, newVersion);
		},
		[sharedNotes],
	);

	async function leaveSharedNote(noteId: string) {
		const db = activeSupabase.current;
		if (!db || !user) return;
		await db
			.from("note_sharing")
			.delete()
			.eq("note_id", noteId)
			.eq("shared_with_id", user.id);
		setSharedNotes((prev) => {
			const next = prev.filter((n) => n.id !== noteId);
			if (selectedId === noteId) {
				setSelectedId(next[0]?.id ?? null);
				setSelectedNoteIds(next[0] ? [next[0].id] : []);
			}
			return next;
		});
		setLeaveConfirmNoteId(null);
	}

	async function unshareOwnNote(noteId: string) {
		const db = activeSupabase.current;
		if (!db || !user) return;
		await db
			.from("note_sharing")
			.delete()
			.eq("note_id", noteId)
			.eq("owner_id", user.id);
		setSharedNotes((prev) => {
			const next = prev.filter((n) => n.id !== noteId);
			if (selectedId === noteId) {
				setSelectedId(next[0]?.id ?? null);
				setSelectedNoteIds(next[0] ? [next[0].id] : []);
			}
			return next;
		});
		setLeaveConfirmNoteId(null);
	}

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
								pinned: note.pinned,
								created_at: note.created_at,
								updated_at: note.updated_at,
								version_num: note.version_num,
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

		const db = activeSupabase.current;
		if (db && user) {
			db.from("notes")
				.update({ pinned: updated.pinned })
				.eq("id", id)
				.then(({ error }) => {
					if (error) console.warn("Supabase pin sync error:", error.message);
				});
		}
	}

	// ── Sorting & filtering ──

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
	const isSharedFolder = activeFolder === "Shared Notes";
	const filteredNotes = useMemo(() => {
		if (isSharedFolder) {
			return searchQuery.trim()
				? sharedNotes.filter((n) => {
						const text = extractAllText(n.content).toLowerCase();
						return text.includes(searchQuery.trim().toLowerCase());
					})
				: sharedNotes;
		}
		const listFilteredNotes = isRecentlyDeleted
			? notes.filter((n) => n.deleted)
			: notes.filter((n) => n.list === activeFolder && !n.deleted);
		return searchQuery.trim()
			? listFilteredNotes.filter((n) => {
					const text = extractAllText(n.content).toLowerCase();
					return text.includes(searchQuery.trim().toLowerCase());
				})
			: listFilteredNotes;
	}, [
		notes,
		activeFolder,
		searchQuery,
		isRecentlyDeleted,
		isSharedFolder,
		sharedNotes,
	]);
	const pinnedNotes = filteredNotes.filter((n) => n.pinned).sort(sortFn);
	const regularNotes = filteredNotes.filter((n) => !n.pinned).sort(sortFn);

	const selectedNote = isSharedFolder
		? (sharedNotes.find((n) => n.id === selectedId) ?? null)
		: (notes.find((n) => n.id === selectedId) ?? null);
	const selectedNoteIsEmpty = selectedNote
		? isNoteEmpty(selectedNote.content)
		: false;

	const allVisibleNotes = searchQuery.trim()
		? [...filteredNotes].sort(sortFn)
		: [...(pinnedExpanded ? pinnedNotes : []), ...regularNotes];

	const sharedNotesMap = useMemo(() => {
		const map = new Map<string, (typeof sharedNotes)[number]>();
		for (const sn of sharedNotes) map.set(sn.id, sn);
		return map;
	}, [sharedNotes]);

	// ── Note click handler ──

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

	// ── Render ──

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
			<Sidebar
				width={sidebarWidth}
				onResizeStart={onResizeStart}
				displayName={displayName}
				avatarNum={avatarNum}
				loading={isSharedFolder ? sharedNotesLoading : loading}
				notes={notes}
				filteredNotes={filteredNotes}
				pinnedNotes={pinnedNotes}
				regularNotes={regularNotes}
				allVisibleNotes={allVisibleNotes}
				selectedId={selectedId}
				selectedNoteIds={selectedNoteIds}
				selectedNoteIsEmpty={selectedNoteIsEmpty}
				showTodoList={showTodoList}
				pinnedExpanded={pinnedExpanded}
				searchQuery={searchQuery}
				activeFolder={activeFolder}
				isRecentlyDeleted={isRecentlyDeleted}
				isSharedFolder={isSharedFolder}
				sharedNotesMap={sharedNotesMap}
				sortFn={sortFn}
				onSelectNote={(noteId, noteIds) => {
					setSelectedId(noteId);
					setSelectedNoteIds(noteIds);
					selectionAnchorId.current = noteId;
				}}
				onNoteClick={handleNoteClick}
				onCreateNote={createNote}
				onDeleteSelectedNotes={deleteSelectedNotes}
				onCleanupEmptyNote={cleanupEmptyNote}
				onSetShowTodoList={setShowTodoList}
				onSetPinnedExpanded={setPinnedExpanded}
				onSetSearchQuery={setSearchQuery}
				onSetActiveFolder={setActiveFolder}
				onSetSidebarFocused={setSidebarFocused}
				onRenameNote={renameNote}
				onContextMenu={setContextMenu}
				onOpenAccount={() => setAccountOpen(true)}
				onOpenAbout={() => setAboutOpen(true)}
				onOpenSettings={() => setSettingsOpen(true)}
				renamingId={renamingId}
				renameValue={renameValue}
				onSetRenamingId={setRenamingId}
				onSetRenameValue={setRenameValue}
				sidebarFocused={sidebarFocused}
				noteListRef={noteListRef}
				searchInputRef={searchInputRef}
				renameInputRef={renameInputRef}
			/>

			<main className="main" onMouseDown={() => setSidebarFocused(false)}>
				{showTodoList ? (
					<TodoList
						supabaseClient={activeSupabase.current}
						userId={user!.id}
						autoSortChecked={autoSortChecked}
						externalUpdate={todoExternalUpdate}
					/>
				) : selectedNote ? (
					<NoteEditor
						key={selectedNote.id}
						note={selectedNote}
						onSave={
							isRecentlyDeleted
								? () => {}
								: isSharedFolder
									? saveSharedNote
									: saveNote
						}
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
						userId={user!.id}
						creatorName={
							isSharedFolder ? (sharedNoteCreator ?? undefined) : undefined
						}
						readOnly={isRecentlyDeleted}
						onShare={
							!isRecentlyDeleted &&
							activeSupabase.current &&
							(!isSharedFolder || sharedNotesMap.get(selectedNote.id)?.is_own)
								? () => setShareModalNoteId(selectedNote.id)
								: undefined
						}
						onLeaveShared={
							isSharedFolder && !sharedNotesMap.get(selectedNote.id)?.is_own
								? () => setLeaveConfirmNoteId(selectedNote.id)
								: undefined
						}
					/>
				) : (
					<div className="empty-state">
						<p className="empty-state-text">
							{loading || sharedNotesLoading
								? "loading…"
								: isSharedFolder
									? "No shared notes yet"
									: "Create a note to get started"}
						</p>
					</div>
				)}
			</main>

			{aboutOpen && (
				<AboutModal
					userRole={userRole}
					supabaseClient={activeSupabase.current}
					user={user}
					onClose={() => setAboutOpen(false)}
					onToast={showToast}
				/>
			)}

			{accountOpen && (
				<AccountModal
					user={user}
					displayName={displayName}
					avatarNum={avatarNum}
					storageUsedLabel={storageUsedLabel}
					supabaseClient={activeSupabase.current}
					onDisplayNameSaved={setDisplayName}
					onAvatarSaved={setAvatarNum}
					onManualSync={performCloudSync}
					onSignOut={async () => {
						if (activeSupabase.current) {
							await activeSupabase.current.auth.signOut();
						}
						activeSupabase.current = null;
						setUser(null);
						setAccountOpen(false);
						setIsAuthenticated(false);
					}}
					onClose={() => setAccountOpen(false)}
				/>
			)}

			{settingsOpen && (
				<SettingsModal
					theme={theme}
					setTheme={setTheme}
					sortNotesBy={sortNotesBy}
					setSortNotesBy={setSortNotesBy}
					newNoteStartWith={newNoteStartWith}
					setNewNoteStartWith={setNewNoteStartWith}
					autoSortChecked={autoSortChecked}
					setAutoSortChecked={setAutoSortChecked}
					onClose={() => setSettingsOpen(false)}
				/>
			)}

			{shareModalNoteId && activeSupabase.current && (
				<ShareNoteModal
					noteId={shareModalNoteId}
					supabaseClient={activeSupabase.current}
					userId={user!.id}
					onClose={() => {
						setShareModalNoteId(null);
						if (isSharedFolder) fetchSharedNotes();
					}}
				/>
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
					) : isSharedFolder ? (
						<>
							{sharedNotesMap.get(contextMenu.noteId)?.is_own ? (
								<>
									<li
										className="context-menu-item"
										onClick={() => {
											setShareModalNoteId(contextMenu.noteId);
											setContextMenu(null);
										}}
									>
										Manage Sharing…
									</li>
									<li className="context-menu-separator" />
									<li
										className="context-menu-item context-menu-item-danger"
										onClick={() => {
											setLeaveConfirmNoteId(contextMenu.noteId);
											setContextMenu(null);
										}}
									>
										Unshare Note
									</li>
								</>
							) : (
								<li
									className="context-menu-item context-menu-item-danger"
									onClick={() => {
										setLeaveConfirmNoteId(contextMenu.noteId);
										setContextMenu(null);
									}}
								>
									Leave Shared Note
								</li>
							)}
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
							{activeSupabase.current && (
								<li
									className="context-menu-item"
									onClick={() => {
										setShareModalNoteId(contextMenu.noteId);
										setContextMenu(null);
									}}
								>
									Share Note…
								</li>
							)}
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

			{leaveConfirmNoteId && (
				<div
					className="share-overlay"
					onMouseDown={() => setLeaveConfirmNoteId(null)}
				>
					<div
						className="leave-confirm-card"
						onMouseDown={(e) => e.stopPropagation()}
					>
						<p className="leave-confirm-title">
							{sharedNotesMap.get(leaveConfirmNoteId)?.is_own
								? "Unshare this note?"
								: "Leave this shared note?"}
						</p>
						<p className="leave-confirm-desc">
							{sharedNotesMap.get(leaveConfirmNoteId)?.is_own
								? "This will remove sharing for all recipients. They will no longer be able to view or edit this note."
								: "You will no longer be able to view or edit this note."}
						</p>
						<div className="leave-confirm-actions">
							<button
								type="button"
								className="leave-confirm-cancel"
								onClick={() => setLeaveConfirmNoteId(null)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="leave-confirm-btn"
								onClick={() => {
									if (sharedNotesMap.get(leaveConfirmNoteId)?.is_own) {
										unshareOwnNote(leaveConfirmNoteId);
									} else {
										leaveSharedNote(leaveConfirmNoteId);
									}
								}}
							>
								{sharedNotesMap.get(leaveConfirmNoteId)?.is_own
									? "Unshare"
									: "Leave"}
							</button>
						</div>
					</div>
				</div>
			)}

			<Alert
				message={toastMessage}
				variant={toastIsShared ? "shared" : toastIsError ? "error" : "default"}
				title={toastIsShared ? "Shared Note" : undefined}
				onDismiss={() => setToastMessage(null)}
				onClick={
					toastIsShared
						? () => {
								setShowTodoList(false);
								setActiveFolder("Shared Notes");
								localStorage.setItem("matcha_activeList", "Shared Notes");
								if (toastSharedNoteId) {
									setSelectedId(toastSharedNoteId);
									setSelectedNoteIds([toastSharedNoteId]);
								}
								setToastMessage(null);
							}
						: undefined
				}
			/>
		</div>
	);
}

export default App;
