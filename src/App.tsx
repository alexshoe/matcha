import React, {
	useState,
	useEffect,
	useLayoutEffect,
	useCallback,
	useMemo,
	useRef,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { NoteEditor } from "./components/NoteEditor";
import { TodoList } from "./components/TodoList";
import { AuthPage } from "./components/AuthPage";
import { Sidebar } from "./components/Sidebar";
import { SettingsModal } from "./components/modals/SettingsModal";
import { ManageListsModal } from "./components/modals/ManageListsModal";
import { AboutModal } from "./components/modals/AboutModal";
import { AccountModal } from "./components/modals/AccountModal";
import { supabase } from "./lib/supabase";
import { deleteAllNoteImages, deleteAllNoteFiles } from "./lib/storage";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { SortNotesBy, NewNoteStart } from "./components/modals/SettingsModal";
import "./styles/index.css";
import { extractPreview, extractAllText, isNoteEmpty } from "./utils/noteContent";
import { formatBytes } from "./utils/format";

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

	// ── Sidebar / UI state ──
	const [sidebarWidth, setSidebarWidth] = useState(240);
	const [pinnedExpanded, setPinnedExpanded] = useState(true);
	const [sidebarFocused, setSidebarFocused] = useState(false);
	const [showTodoList, setShowTodoList] = useState(false);
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
	const [manageListsOpen, setManageListsOpen] = useState(false);

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

	// ── Folder / list state ──
	const [noteLists, setNoteLists] = useState<string[]>(() => {
		const saved = localStorage.getItem("matcha_noteLists");
		if (!saved) return ["My Notes"];
		try {
			return JSON.parse(saved);
		} catch {
			return ["My Notes"];
		}
	});
	const [activeFolder, setActiveFolder] = useState<string>(
		() => localStorage.getItem("matcha_activeList") || "My Notes",
	);

	// ── Toast ──
	const [toastMessage, setToastMessage] = useState<string | null>(null);
	const [toastIsError, setToastIsError] = useState(false);

	// ── Shared notes ──
	const [sharedNoteCreator, setSharedNoteCreator] = useState<string | null>(
		null,
	);

	// ── Animation ref ──
	const prevNoteRects = useRef<Map<string, DOMRect>>(new Map());

	const SIDEBAR_MIN = 200;
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
			if (manageListsOpen) setManageListsOpen(false);
			else if (aboutOpen) setAboutOpen(false);
			else if (accountOpen) setAccountOpen(false);
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

		db.rpc("get_storage_used_bytes")
			.then(({ data, error: rpcErr }) => {
				if (rpcErr || data === null) {
					setStorageUsedLabel(formatBytes(computeLocal()));
					return;
				}
				setStorageUsedLabel(formatBytes(data as number));
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
			client.auth.getUser().then(({ data: { user: serverUser }, error }) => {
				if (serverUser && !error) {
					activeSupabase.current = client;
					setUser(serverUser);
					setIsAuthenticated(true);
				} else {
					client.auth.signOut();
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
				} else if (session?.user) {
					setUser(session.user);
				}
			});

			return () => subscription.unsubscribe();
		}
	}, []);

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

	// ── List management ──

	function persistLists(lists: string[]) {
		setNoteLists(lists);
		localStorage.setItem("matcha_noteLists", JSON.stringify(lists));
	}

	function addList(name: string) {
		const trimmed = name.trim();
		if (!trimmed || noteLists.includes(trimmed)) return;
		persistLists([...noteLists, trimmed]);
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

	// ── Toast helper ──

	function showToast(message: string, isError: boolean) {
		setToastIsError(isError);
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
							pinned: note.pinned,
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
	const filteredNotes = useMemo(() => {
		const listFilteredNotes = isRecentlyDeleted
			? notes.filter((n) => n.deleted)
			: notes.filter((n) => n.list === activeFolder && !n.deleted);
		return searchQuery.trim()
			? listFilteredNotes.filter((n) => {
					const text = extractAllText(n.content).toLowerCase();
					return text.includes(searchQuery.trim().toLowerCase());
				})
			: listFilteredNotes;
	}, [notes, activeFolder, searchQuery, isRecentlyDeleted]);
	const pinnedNotes = filteredNotes.filter((n) => n.pinned).sort(sortFn);
	const regularNotes = filteredNotes.filter((n) => !n.pinned).sort(sortFn);

	const selectedNote = notes.find((n) => n.id === selectedId) ?? null;
	const selectedNoteIsEmpty = selectedNote
		? isNoteEmpty(selectedNote.content)
		: false;

	const allVisibleNotes = searchQuery.trim()
		? [...filteredNotes].sort(sortFn)
		: [...(pinnedExpanded ? pinnedNotes : []), ...regularNotes];

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
				loading={loading}
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
				noteLists={noteLists}
				isRecentlyDeleted={isRecentlyDeleted}
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
				onOpenManageLists={() => setManageListsOpen(true)}
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
					<TodoList supabaseClient={activeSupabase.current} userId={user!.id} autoSortChecked={autoSortChecked} />
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
						userId={user!.id}
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

			{manageListsOpen && (
				<ManageListsModal
					noteLists={noteLists}
					activeFolder={activeFolder}
					onAddList={addList}
					onRemoveList={removeList}
					onRenameList={finishRenameList}
					onClose={() => setManageListsOpen(false)}
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
