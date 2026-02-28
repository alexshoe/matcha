import { useState, useRef, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faPenToSquare,
	faChevronDown,
	faGear,
	faCircleQuestion,
	faCheck,
	faMagnifyingGlass,
	faXmark,
	faSquareCheck,
	faUser,
} from "@fortawesome/free-solid-svg-icons";
import type { Note, SharedNoteEntry } from "@matcha/core";
import { extractPreview } from "@matcha/core";
import { getSearchSnippet, highlightText } from "@matcha/core";
import { formatDate } from "@matcha/core";

interface SidebarProps {
	width: number;
	onResizeStart: (e: React.MouseEvent) => void;
	displayName: string;
	avatarNum: number | null;
	loading: boolean;
	notes: Note[];
	filteredNotes: Note[];
	pinnedNotes: Note[];
	regularNotes: Note[];
	allVisibleNotes: Note[];
	selectedId: string | null;
	selectedNoteIds: string[];
	selectedNoteIsEmpty: boolean;
	showTodoList: boolean;
	pinnedExpanded: boolean;
	searchQuery: string;
	activeFolder: string;
	isRecentlyDeleted: boolean;
	isSharedFolder: boolean;
	sharedNotesMap: Map<string, SharedNoteEntry>;
	sortFn: (a: Note, b: Note) => number;
	onSelectNote: (noteId: string, noteIds: string[]) => void;
	onNoteClick: (note: Note, e: React.MouseEvent) => void;
	onCreateNote: () => void;
	onDeleteSelectedNotes: () => void;
	onCleanupEmptyNote: (id: string | null) => void;
	onSetShowTodoList: (show: boolean) => void;
	onSetPinnedExpanded: (fn: (prev: boolean) => boolean) => void;
	onSetSearchQuery: (query: string) => void;
	onSetActiveFolder: (folder: string) => void;
	onSetSidebarFocused: (focused: boolean) => void;
	onRenameNote: (id: string, newTitle: string) => void;
	onContextMenu: (
		menu: { x: number; y: number; noteId: string } | null,
	) => void;
	onOpenAccount: () => void;
	onOpenAbout: () => void;
	onOpenSettings: () => void;
	renamingId: string | null;
	renameValue: string;
	onSetRenamingId: (id: string | null) => void;
	onSetRenameValue: (value: string) => void;
	sidebarFocused: boolean;
	noteListRef: React.RefObject<HTMLDivElement>;
	searchInputRef: React.RefObject<HTMLInputElement>;
	renameInputRef: React.RefObject<HTMLInputElement>;
}

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

export function Sidebar({
	width,
	onResizeStart,
	displayName: _displayName,
	avatarNum,
	loading,
	filteredNotes,
	pinnedNotes,
	regularNotes,
	allVisibleNotes,
	selectedId,
	selectedNoteIds,
	selectedNoteIsEmpty,
	showTodoList,
	pinnedExpanded,
	searchQuery,
	activeFolder,
	isRecentlyDeleted,
	isSharedFolder,
	sharedNotesMap,
	sortFn,
	onSelectNote,
	onNoteClick,
	onCreateNote,
	onDeleteSelectedNotes,
	onCleanupEmptyNote,
	onSetShowTodoList,
	onSetPinnedExpanded,
	onSetSearchQuery,
	onSetActiveFolder,
	onSetSidebarFocused,
	onRenameNote,
	onContextMenu,
	onOpenAccount,
	onOpenAbout,
	onOpenSettings,
	renamingId,
	renameValue,
	onSetRenamingId,
	onSetRenameValue,
	sidebarFocused,
	noteListRef,
	searchInputRef,
	renameInputRef,
}: SidebarProps) {
	const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
	const folderDropdownRef = useRef<HTMLDivElement>(null);
	const [avatarDropdownOpen, setAvatarDropdownOpen] = useState(false);
	const avatarDropdownRef = useRef<HTMLDivElement>(null);

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
		if (!avatarDropdownOpen) return;
		function handleClick(e: MouseEvent) {
			if (
				avatarDropdownRef.current &&
				!avatarDropdownRef.current.contains(e.target as Node)
			) {
				setAvatarDropdownOpen(false);
			}
		}
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") setAvatarDropdownOpen(false);
		}
		window.addEventListener("mousedown", handleClick);
		window.addEventListener("keydown", handleKey);
		return () => {
			window.removeEventListener("mousedown", handleClick);
			window.removeEventListener("keydown", handleKey);
		};
	}, [avatarDropdownOpen]);

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
				onClick={(e) => onNoteClick(note, e)}
				onContextMenu={(e) => {
					e.preventDefault();
					e.stopPropagation();
					onContextMenu({ x: e.clientX, y: e.clientY, noteId: note.id });
				}}
			>
				{isRenaming ? (
					<input
						ref={renameInputRef}
						className="note-rename-input"
						value={renameValue}
						onChange={(e) => onSetRenameValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								onRenameNote(note.id, renameValue);
								onSetRenamingId(null);
							} else if (e.key === "Escape") {
								onSetRenamingId(null);
							}
						}}
						onBlur={() => {
							if (renameValue.trim()) onRenameNote(note.id, renameValue.trim());
							onSetRenamingId(null);
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
				{isSharedFolder &&
					(() => {
						const shared = sharedNotesMap.get(note.id);
						if (!shared) return null;
						const label = shared.is_own
							? `Shared with ${shared.shared_with_names?.join(", ") ?? "…"}`
							: `By ${shared.owner_display_name}`;
						return (
							<div className="note-item-shared-by">
								{!shared.is_own && shared.owner_avatar_num && (
									<img
										src={`/avatars/avatar_${shared.owner_avatar_num}.png`}
										alt=""
										className="note-item-shared-avatar"
									/>
								)}
								{label}
							</div>
						);
					})()}
			</button>
		);
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			onDeleteSelectedNotes();
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
					targetIdx = bottomIdx < ids.length - 1 ? bottomIdx + 1 : bottomIdx;
				}
			} else {
				const currentIdx = ids.indexOf(selectedId ?? "");
				if (currentIdx === -1) {
					targetIdx = 0;
				} else {
					targetIdx = e.key === "ArrowUp" ? currentIdx - 1 : currentIdx + 1;
				}
			}

			if (targetIdx < 0 || targetIdx >= ids.length) return;
			const newId = ids[targetIdx];
			if (selectedId && selectedId !== newId) {
				onCleanupEmptyNote(selectedId);
			}
			onSelectNote(newId, [newId]);

			requestAnimationFrame(() => {
				noteListRef.current
					?.querySelector(`[data-note-id="${newId}"]`)
					?.scrollIntoView({ block: "nearest" });
			});
		}
	}

	return (
		<aside className="sidebar" style={{ width }}>
			<div className="sidebar-header">
				<div
					className="sidebar-folder-wrap folder-picker-wrap"
					ref={folderDropdownRef}
				>
					<button
						className="sidebar-folder-btn"
						onClick={() => setFolderDropdownOpen((v) => !v)}
					>
						<div className="sidebar-folder-content">
							<div className="sidebar-folder-name-row">
								<span className="sidebar-folder-label">{activeFolder}</span>
								<FontAwesomeIcon
									icon={faChevronDown}
									className={`folder-chevron${folderDropdownOpen ? " open" : ""}`}
								/>
							</div>
						</div>
					</button>
					{folderDropdownOpen && (
						<div className="folder-dropdown folder-dropdown--header">
							{(["My Notes", "Shared Notes", "Recently Deleted"] as const).map(
								(name) => (
									<button
										key={name}
										className={`folder-dropdown-item${activeFolder === name ? " active" : ""}`}
										onClick={() => {
											onSetActiveFolder(name);
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
								),
							)}
						</div>
					)}
				</div>
				<div className="sidebar-header-actions">
					<button
						className="new-note-fab"
						onClick={onCreateNote}
						title="New Note"
						disabled={selectedNoteIsEmpty}
					>
						<FontAwesomeIcon icon={faPenToSquare} />
					</button>
				</div>
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
					onChange={(e) => onSetSearchQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							onSetSearchQuery("");
							searchInputRef.current?.blur();
						}
					}}
				/>
				{searchQuery && (
					<button
						className="sidebar-search-clear"
						onClick={() => {
							onSetSearchQuery("");
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
					onCleanupEmptyNote(selectedId);
					onSetShowTodoList(true);
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
				onMouseDown={() => onSetSidebarFocused(true)}
				onKeyDown={handleKeyDown}
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
						{pinnedNotes.length > 0 && !isRecentlyDeleted && (
							<>
								<div
									className="note-list-section-label"
									onClick={() => onSetPinnedExpanded((v) => !v)}
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
						<div className="note-list-section-label note-list-section-label--plain">
							<span>{activeFolder}</span>
						</div>
						{(isRecentlyDeleted
							? [...filteredNotes].sort(sortFn)
							: regularNotes
						).map((note) => renderNoteItem(note))}
					</>
				)}
			</div>
			<div className="sidebar-footer">
				<div className="sidebar-footer-avatar-wrap" ref={avatarDropdownRef}>
					{avatarDropdownOpen && (
						<div className="avatar-dropdown">
							<button
								className="avatar-dropdown-item"
								onClick={() => {
									onOpenAccount();
									setAvatarDropdownOpen(false);
								}}
							>
								<FontAwesomeIcon
									icon={faUser}
									className="avatar-dropdown-item-icon"
								/>
								<span>User Settings</span>
							</button>
							<button
								className="avatar-dropdown-item"
								onClick={() => {
									onOpenSettings();
									setAvatarDropdownOpen(false);
								}}
							>
								<FontAwesomeIcon
									icon={faGear}
									className="avatar-dropdown-item-icon"
								/>
								<span>Note Settings</span>
							</button>
							<div className="avatar-dropdown-separator" />
							<button
								className="avatar-dropdown-item"
								onClick={() => {
									onOpenAbout();
									setAvatarDropdownOpen(false);
								}}
							>
								<FontAwesomeIcon
									icon={faCircleQuestion}
									className="avatar-dropdown-item-icon"
								/>
								<span>About</span>
							</button>
						</div>
					)}
					<div
						className="sidebar-footer-avatar"
						role="button"
						onClick={() => setAvatarDropdownOpen((v) => !v)}
					>
						{avatarNum ? (
							<img
								src={`/avatars/avatar_${avatarNum}.png`}
								alt="Avatar"
								className="sidebar-footer-avatar-img"
							/>
						) : (
							avatarFallback
						)}
					</div>
				</div>
			</div>
			<div className="sidebar-resize-handle" onMouseDown={onResizeStart} />
		</aside>
	);
}
