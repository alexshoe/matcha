import { useEditor, EditorContent } from "@tiptap/react";
import { Extension, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { OrderedList } from "@tiptap/extension-ordered-list";
import { TaskList } from "@tiptap/extension-task-list";
import Link from "@tiptap/extension-link";
import { DraggableTaskItem, ResizableImage, PasteUrlToLink } from "@matcha/ui";
import { FileAttachment } from "../extensions/FileAttachment";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import React, { useRef, useState, useEffect, useReducer } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faSquareCheck,
	faTableCellsLarge,
	faPaperclip,
	faImage,
	faFilePdf,
	faTrash,
	faArrowRotateLeft,
	faUserPlus,
	faRightFromBracket,
	faMagnifyingGlass,
	faChevronUp,
	faChevronDown,
	faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Note } from "@matcha/core";
import {
	uploadNoteImage,
	uploadNoteFile,
	deleteNoteImages,
	deleteNoteFiles,
	extractStorageUrls,
} from "@matcha/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";

const CounterOrderedList = OrderedList.extend({
	renderHTML({ HTMLAttributes }) {
		const start = HTMLAttributes.start || 1;
		return [
			"ol",
			mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
				style: `counter-reset: list-counter ${start - 1}`,
			}),
			0,
		];
	},
});

const sortTaskListKey = new PluginKey("sortTaskList");

const SortTaskItems = Extension.create<{ getEnabled: () => boolean }>({
	name: "sortTaskItems",
	addOptions() {
		return { getEnabled: () => true };
	},
	addProseMirrorPlugins() {
		const getEnabled = this.options.getEnabled;
		return [
			new Plugin({
				key: sortTaskListKey,
				appendTransaction(transactions, _oldState, newState) {
					if (!getEnabled()) return null;
					if (transactions.some((tr) => tr.getMeta(sortTaskListKey)))
						return null;
					if (!transactions.some((tr) => tr.docChanged)) return null;

					const replacements: { from: number; to: number; replacement: any }[] =
						[];

					newState.doc.descendants((node, pos) => {
						if (node.type.name !== "taskList") return;

						const children: any[] = [];
						node.forEach((child) => children.push(child));

						const sorted = [...children].sort(
							(a, b) => (a.attrs.checked ? 1 : 0) - (b.attrs.checked ? 1 : 0),
						);

						// Check if order needs to change by checked state or content
						const needsSort = children.some(
							(c, i) =>
								c !== sorted[i] &&
								(c.attrs.checked !== sorted[i].attrs.checked ||
									!c.content.eq(sorted[i].content)),
						);
						if (!needsSort) return;

						replacements.push({
							from: pos,
							to: pos + node.nodeSize,
							replacement: node.type.create(node.attrs, sorted, node.marks),
						});
					});

					if (replacements.length === 0) return null;

					const tr = newState.tr;
					tr.setMeta(sortTaskListKey, true);
					replacements.reverse().forEach(({ from, to, replacement }) => {
						tr.replaceWith(from, to, replacement);
					});
					return tr;
				},
			}),
		];
	},
});

interface Props {
	note: Note;
	onSave: (id: string, content: string) => void;
	onDelete: () => void;
	onRestore?: () => void;
	onContentChange?: (id: string, content: string) => void;
	newNoteStartWith?: "title" | "heading" | "subheading" | "body";
	autoSortChecked?: boolean;
	autoFocus?: boolean;
	supabaseClient?: SupabaseClient | null;
	userId: string;
	creatorName?: string;
	readOnly?: boolean;
	onShare?: () => void;
	onLeaveShared?: () => void;
}

function formatTimestamp(ts: number): string {
	const d = new Date(ts * 1000);
	const date = d.toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
	});
	const time = d.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
	return `${date} at ${time}`;
}

type TextStyle =
	| "heading1"
	| "heading2"
	| "heading3"
	| "paragraph"
	| "monostyled"
	| "bulletList"
	| "orderedList"
	| "blockquote";

const BLOCK_STYLES: {
	value: TextStyle;
	label: string;
	prefix?: string;
	dividerBefore?: boolean;
}[] = [
	{ value: "heading1", label: "Title" },
	{ value: "heading2", label: "Heading" },
	{ value: "heading3", label: "Subheading" },
	{ value: "paragraph", label: "Body" },
	{ value: "monostyled", label: "Monostyled" },
	{ value: "bulletList", label: "Bulleted List", prefix: "•" },
	{ value: "orderedList", label: "Numbered List", prefix: "1." },
	{ value: "blockquote", label: "Block Quote" },
];

const INDENT_PX = 28;
const MAX_INDENT = 10;

function findListItem(state: { selection: { $from: any } }) {
	const { $from } = state.selection;
	for (let d = $from.depth; d > 0; d--) {
		const node = $from.node(d);
		if (node.type.name === "taskItem" || node.type.name === "listItem") {
			return { node, depth: d, pos: $from.before(d) };
		}
	}
	return null;
}

function indentListItem(editor: any): boolean {
	const hit = findListItem(editor.state);
	if (!hit) return false;
	const indent = hit.node.attrs.indent || 0;
	if (indent < MAX_INDENT) {
		editor.view.dispatch(
			editor.state.tr.setNodeMarkup(hit.pos, undefined, {
				...hit.node.attrs,
				indent: indent + 1,
			}),
		);
	}
	return true;
}

function outdentListItem(editor: any): boolean {
	const hit = findListItem(editor.state);
	if (!hit) return false;
	const indent = hit.node.attrs.indent || 0;
	if (indent > 0) {
		editor.view.dispatch(
			editor.state.tr.setNodeMarkup(hit.pos, undefined, {
				...hit.node.attrs,
				indent: indent - 1,
			}),
		);
	}
	return true;
}

const TabIndent = Extension.create({
	name: "tabIndent",

	addGlobalAttributes() {
		return [
			{
				types: ["taskItem", "listItem"],
				attributes: {
					indent: {
						default: 0,
						parseHTML: (element: HTMLElement) =>
							parseInt(element.getAttribute("data-indent") || "0", 10),
						renderHTML: (attributes: Record<string, any>) => {
							if (!attributes.indent) return {};
							return {
								"data-indent": attributes.indent,
								style: `margin-left: ${attributes.indent * INDENT_PX}px`,
							};
						},
					},
				},
			},
		];
	},

	addKeyboardShortcuts() {
		return {
			Tab: ({ editor }) => {
				if (editor.isActive("table")) {
					return editor.commands.goToNextCell();
				}
				if (indentListItem(editor)) return true;
				editor.view.dispatch(editor.state.tr.insertText("\t"));
				return true;
			},

			"Shift-Tab": ({ editor }) => {
				if (editor.isActive("table")) {
					return editor.commands.goToPreviousCell();
				}
				if (outdentListItem(editor)) return true;
				return true;
			},

			"Mod-]": ({ editor }) => indentListItem(editor),

			"Mod-[": ({ editor }) => outdentListItem(editor),

			Backspace: ({ editor }) => {
				const { $from, empty } = editor.state.selection;
				if (!empty || $from.parentOffset !== 0) return false;
				const hit = findListItem(editor.state);
				if (!hit) return false;
				if ($from.index(hit.depth) !== 0) return false;
				const indent = hit.node.attrs.indent || 0;
				if (indent > 0) {
					editor.view.dispatch(
						editor.state.tr.setNodeMarkup(hit.pos, undefined, {
							...hit.node.attrs,
							indent: indent - 1,
						}),
					);
					return true;
				}
				return false;
			},
		};
	},
});

const singleLevelBqKey = new PluginKey("singleLevelBlockquote");

const SingleLevelBlockquote = Extension.create({
	name: "singleLevelBlockquote",
	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: singleLevelBqKey,
				appendTransaction(transactions, _oldState, newState) {
					if (!transactions.some((tr) => tr.docChanged)) return null;

					const nested: { from: number; to: number; content: any }[] = [];

					newState.doc.descendants((node, pos) => {
						if (node.type.name !== "blockquote") return;
						const $pos = newState.doc.resolve(pos);
						for (let d = $pos.depth; d > 0; d--) {
							if ($pos.node(d).type.name === "blockquote") {
								nested.push({
									from: pos,
									to: pos + node.nodeSize,
									content: node.content,
								});
								return false;
							}
						}
					});

					if (nested.length === 0) return null;

					const tr = newState.tr;
					for (let i = nested.length - 1; i >= 0; i--) {
						const { from, to, content } = nested[i];
						tr.replaceWith(from, to, content);
					}
					return tr;
				},
			}),
		];
	},
});

// ── In-note search ────────────────────────────────────────────────────────────

const searchPluginKey = new PluginKey<{ query: string; currentIndex: number }>(
	"searchHighlight",
);

function findAllMatches(
	doc: any,
	query: string,
): { from: number; to: number }[] {
	if (!query.trim()) return [];
	const results: { from: number; to: number }[] = [];
	const q = query.toLowerCase();
	doc.descendants((node: any, pos: number) => {
		if (!node.isText) return;
		const text: string = node.text!.toLowerCase();
		let i = 0;
		while (true) {
			const f = text.indexOf(q, i);
			if (f === -1) break;
			results.push({ from: pos + f, to: pos + f + query.length });
			i = f + 1;
		}
	});
	return results;
}

const SearchHighlight = Extension.create({
	name: "searchHighlight",
	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: searchPluginKey,
				state: {
					init() {
						return { query: "", currentIndex: 0 };
					},
					apply(tr, prev) {
						const meta = tr.getMeta(searchPluginKey);
						return meta !== undefined ? meta : prev;
					},
				},
				props: {
					decorations(state) {
						const { query, currentIndex } = searchPluginKey.getState(state)!;
						if (!query.trim()) return DecorationSet.empty;
						const matches = findAllMatches(state.doc, query);
						if (matches.length === 0) return DecorationSet.empty;
						const decos = matches.map((m, i) =>
							Decoration.inline(m.from, m.to, {
								class:
									i === currentIndex ? "search-match-current" : "search-match",
							}),
						);
						return DecorationSet.create(state.doc, decos);
					},
				},
			}),
		];
	},
});

// ── End in-note search ────────────────────────────────────────────────────────

function defaultContentForStartWith(startWith: string) {
	switch (startWith) {
		case "heading":
			return {
				type: "doc",
				content: [{ type: "heading", attrs: { level: 2 } }],
			};
		case "subheading":
			return {
				type: "doc",
				content: [{ type: "heading", attrs: { level: 3 } }],
			};
		case "body":
			return { type: "doc", content: [{ type: "paragraph" }] };
		default:
			return {
				type: "doc",
				content: [{ type: "heading", attrs: { level: 1 } }],
			};
	}
}

function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

const imageMimeMap: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	svg: "image/svg+xml",
	heic: "image/heic",
};

async function readPathAsFile(
	filePath: string,
	mimeMap: Record<string, string>,
): Promise<File> {
	const bytes = await readFile(filePath);
	const name = filePath.split(/[\\/]/).pop() || "file";
	const ext = name.split(".").pop()?.toLowerCase() || "";
	const mime = mimeMap[ext] || "application/octet-stream";
	return new File([bytes], name, { type: mime });
}

export function NoteEditor({
	note,
	onSave,
	onDelete,
	onRestore,
	onContentChange,
	newNoteStartWith = "title",
	autoSortChecked = true,
	autoFocus = true,
	supabaseClient,
	userId,
	creatorName,
	readOnly = false,
	onShare,
	onLeaveShared,
}: Props) {
	const saveTimer = useRef<ReturnType<typeof setTimeout>>();
	const [stylePickerOpen, setStylePickerOpen] = useState(false);
	const [attachMenuOpen, setAttachMenuOpen] = useState(false);
	const [findOpen, setFindOpen] = useState(false);
	const [findQuery, setFindQuery] = useState("");
	const [findIndex, setFindIndex] = useState(0);
	const stylePickerRef = useRef<HTMLDivElement>(null);
	const attachMenuRef = useRef<HTMLDivElement>(null);
	const editorScrollRef = useRef<HTMLDivElement>(null);
	const findInputRef = useRef<HTMLInputElement>(null);
	const autoSortRef = useRef(autoSortChecked);
	autoSortRef.current = autoSortChecked;
	const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

	const supabaseRef = useRef(supabaseClient);
	supabaseRef.current = supabaseClient;
	const userIdRef = useRef(userId);
	userIdRef.current = userId;

	const extracted = extractStorageUrls(note.content);
	const knownImageUrls = useRef<Set<string>>(new Set(extracted.imageUrls));
	const knownFileUrls = useRef<Set<string>>(new Set(extracted.fileUrls));

	const resolveImage = useRef<(file: File) => Promise<string>>();
	resolveImage.current = async (file: File) => {
		const db = supabaseRef.current;
		const uid = userIdRef.current;
		if (db && uid) {
			const url = await uploadNoteImage(db, uid, note.id, file);
			if (url) {
				knownImageUrls.current.add(url);
				return url;
			}
		}
		return fileToBase64(file);
	};

	const resolveFile =
		useRef<
			(
				file: File,
			) => Promise<{ src: string; fileName: string; fileSize: number } | null>
		>();
	resolveFile.current = async (file: File) => {
		const db = supabaseRef.current;
		const uid = userIdRef.current;
		if (!db || !uid) return null;
		const url = await uploadNoteFile(db, uid, note.id, file);
		if (!url) return null;
		knownFileUrls.current.add(url);
		return { src: url, fileName: file.name, fileSize: file.size };
	};

	const extensions = [
		StarterKit.configure({
			heading: { levels: [1, 2, 3] },
			orderedList: false,
		}),
		CounterOrderedList,
		Link.configure({
			openOnClick: false,
			autolink: false,
			linkOnPaste: false,
		}),
		PasteUrlToLink,
		TaskList,
		DraggableTaskItem.configure({ nested: true }),
		ResizableImage.configure({ inline: false, allowBase64: true }),
		FileAttachment,
		Table.configure({ resizable: true, lastColumnResizable: false }),
		TableRow,
		TableCell,
		TableHeader,
		SingleLevelBlockquote,
		TabIndent,
		SortTaskItems.configure({ getEnabled: () => autoSortRef.current }),
		SearchHighlight,
	];

	const editor = useEditor({
		extensions,
		content: (() => {
			if (!note.content) return defaultContentForStartWith(newNoteStartWith);
			try {
				return JSON.parse(note.content);
			} catch {
				return defaultContentForStartWith(newNoteStartWith);
			}
		})(),
		editable: !readOnly,
		autofocus: autoFocus ? "end" : false,
		onUpdate({ editor }) {
			const json = JSON.stringify(editor.getJSON());
			onContentChange?.(note.id, json);
			clearTimeout(saveTimer.current);
			saveTimer.current = setTimeout(() => {
				const current = extractStorageUrls(json);
				const currentImages = new Set(current.imageUrls);
				const currentFiles = new Set(current.fileUrls);

				const removedImages = [...knownImageUrls.current].filter(
					(u) => !currentImages.has(u),
				);
				const removedFiles = [...knownFileUrls.current].filter(
					(u) => !currentFiles.has(u),
				);

				if (removedImages.length > 0 && supabaseRef.current) {
					deleteNoteImages(supabaseRef.current, removedImages);
				}
				if (removedFiles.length > 0 && supabaseRef.current) {
					deleteNoteFiles(supabaseRef.current, removedFiles);
				}

				knownImageUrls.current = currentImages;
				knownFileUrls.current = currentFiles;

				onSave(note.id, json);
			}, 1000);
		},
		editorProps: {
			handleClick(_view, _pos, event) {
				const target = event.target as HTMLElement;
				const anchor = target.closest("a");
				if (!anchor) return false;
				const href = anchor.getAttribute("href");
				if (!href) return false;
				event.preventDefault();
				openUrl(href).catch(() => {});
				return true;
			},
			handlePaste(view, event) {
				const items = event.clipboardData?.items;
				if (!items) return false;
				const imageFiles: File[] = [];
				for (let i = 0; i < items.length; i++) {
					if (items[i].type.startsWith("image/")) {
						const file = items[i].getAsFile();
						if (file) imageFiles.push(file);
					}
				}
				if (imageFiles.length === 0) return false;
				event.preventDefault();
				const ed = view.dom.closest(".editor") ? editor : null;
				if (ed) {
					imageFiles.forEach(async (file) => {
						const src = await resolveImage.current!(file);
						ed.chain().focus().setImage({ src }).run();
					});
				}
				return true;
			},
			handleDrop(view, event) {
				const files = event.dataTransfer?.files;
				if (!files || files.length === 0) return false;
				const imageFiles: File[] = [];
				const pdfFiles: File[] = [];
				for (let i = 0; i < files.length; i++) {
					if (files[i].type.startsWith("image/")) {
						imageFiles.push(files[i]);
					} else if (files[i].type === "application/pdf") {
						pdfFiles.push(files[i]);
					}
				}
				if (imageFiles.length === 0 && pdfFiles.length === 0) return false;
				event.preventDefault();
				if (editor) {
					const pos = view.posAtCoords({
						left: event.clientX,
						top: event.clientY,
					});
					// Insert images at drop position
					imageFiles.forEach(async (file) => {
						const src = await resolveImage.current!(file);
						if (pos) {
							editor
								.chain()
								.focus()
								.setTextSelection(pos.pos)
								.setImage({ src })
								.run();
						} else {
							editor.chain().focus().setImage({ src }).run();
						}
					});
					// Insert PDFs as file attachments at drop position
					pdfFiles.forEach(async (file) => {
						const result = await resolveFile.current!(file);
						if (result) {
							if (pos) {
								editor
									.chain()
									.focus()
									.setTextSelection(pos.pos)
									.insertContent({
										type: "fileAttachment",
										attrs: result,
									})
									.run();
							} else {
								editor
									.chain()
									.focus()
									.insertContent({
										type: "fileAttachment",
										attrs: result,
									})
									.run();
							}
						}
					});
				}
				return true;
			},
		},
	});

	// ── Apply remote content updates for the currently-open note ──
	const lastAppliedVersion = useRef(note.version_num);
	useEffect(() => {
		if (!editor) return;
		if (note.version_num <= lastAppliedVersion.current) return;
		lastAppliedVersion.current = note.version_num;
		// Don't clobber in-progress local edits
		if (saveTimer.current) return;
		try {
			const parsed = note.content ? JSON.parse(note.content) : null;
			if (parsed) editor.commands.setContent(parsed, { emitUpdate: false });
		} catch {
			// ignore malformed content
		}
	}, [editor, note.version_num, note.content]);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (
				stylePickerRef.current &&
				!stylePickerRef.current.contains(e.target as Node)
			) {
				setStylePickerOpen(false);
			}
			if (
				attachMenuRef.current &&
				!attachMenuRef.current.contains(e.target as Node)
			) {
				setAttachMenuOpen(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Re-render when editor doc changes while find bar is open (keeps counter fresh)
	useEffect(() => {
		if (!editor || !findOpen) return;
		editor.on("update", forceUpdate);
		return () => {
			editor.off("update", forceUpdate);
		};
	}, [editor, findOpen]);

	// Cmd+F / Ctrl+F global shortcut
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "f") {
				e.preventDefault();
				setFindOpen(true);
				setTimeout(() => {
					findInputRef.current?.focus();
					findInputRef.current?.select();
				}, 10);
			}
		};
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, []);

	if (!editor) return null;

	function dispatchSearch(query: string, index: number) {
		if (!editor) return;
		editor.view.dispatch(
			editor.state.tr.setMeta(searchPluginKey, { query, currentIndex: index }),
		);
	}

	function closeFindBar() {
		setFindOpen(false);
		setFindQuery("");
		setFindIndex(0);
		dispatchSearch("", 0);
	}

	function navigateFind(dir: 1 | -1) {
		if (!editor || !findQuery.trim()) return;
		const matches = findAllMatches(editor.state.doc, findQuery);
		if (matches.length === 0) return;
		const newIndex =
			(((findIndex + dir) % matches.length) + matches.length) % matches.length;
		setFindIndex(newIndex);
		dispatchSearch(findQuery, newIndex);
		setTimeout(() => {
			document
				.querySelector(".search-match-current")
				?.scrollIntoView({ block: "center", behavior: "smooth" });
		}, 0);
	}

	function activeStyle(): TextStyle {
		if (!editor) return "paragraph";
		if (editor.isActive("heading", { level: 1 })) return "heading1";
		if (editor.isActive("heading", { level: 2 })) return "heading2";
		if (editor.isActive("heading", { level: 3 })) return "heading3";
		if (editor.isActive("codeBlock")) return "monostyled";
		if (editor.isActive("bulletList")) return "bulletList";
		if (editor.isActive("orderedList")) return "orderedList";
		if (editor.isActive("blockquote")) return "blockquote";
		return "paragraph";
	}

	function applyStyle(style: TextStyle) {
		if (!editor) return;
		switch (style) {
			case "paragraph":
				editor.chain().focus().setParagraph().run();
				break;
			case "heading1":
				editor.chain().focus().setHeading({ level: 1 }).run();
				break;
			case "heading2":
				editor.chain().focus().setHeading({ level: 2 }).run();
				break;
			case "heading3":
				editor.chain().focus().setHeading({ level: 3 }).run();
				break;
			case "monostyled":
				editor.chain().focus().toggleCodeBlock().run();
				break;
			case "bulletList":
				editor.chain().focus().toggleBulletList().run();
				break;
			case "orderedList":
				editor.chain().focus().toggleOrderedList().run();
				break;
			case "blockquote": {
				const { state } = editor;
				const { from, to } = state.selection;
				let allInBq = true;
				let count = 0;
				state.doc.nodesBetween(from, to, (node, pos) => {
					if (node.isTextblock) {
						count++;
						const $pos = state.doc.resolve(pos);
						let inBq = false;
						for (let d = $pos.depth; d > 0; d--) {
							if ($pos.node(d).type.name === "blockquote") {
								inBq = true;
								break;
							}
						}
						if (!inBq) allInBq = false;
					}
				});
				if (count > 0) {
					if (allInBq) {
						editor.chain().focus().lift("blockquote").run();
					} else {
						while (editor.can().lift("blockquote"))
							editor.commands.lift("blockquote");
						editor.chain().focus().setBlockquote().run();
					}
				}
				break;
			}
		}
		setStylePickerOpen(false);
	}

	const btn = (active: boolean, extra?: string) =>
		`toolbar-btn${active ? " active" : ""}${extra ? " " + extra : ""}`;

	return (
		<div className="editor-wrap">
			<div className="toolbar">
				<div className="toolbar-spacer" />

				{readOnly ? (
					<div className="toolbar-center-group">
						{onRestore && (
							<button
								className={btn(false)}
								onMouseDown={(e) => {
									e.preventDefault();
									onRestore();
								}}
								title="Restore Note"
							>
								<FontAwesomeIcon icon={faArrowRotateLeft} />
							</button>
						)}
						<button
							className={btn(false, "toolbar-btn-danger")}
							onMouseDown={(e) => {
								e.preventDefault();
								onDelete();
							}}
							title="Delete Permanently"
						>
							<FontAwesomeIcon icon={faTrash} />
						</button>
					</div>
				) : (
					<div className="toolbar-center-group">
						{/* ── Text style (Aa dropdown) ── */}
						<div className="style-dropdown-wrap" ref={stylePickerRef}>
							<button
								className={btn(stylePickerOpen)}
								onClick={() => setStylePickerOpen((v) => !v)}
								title="Text Style"
							>
								<span className="aa-label">Aa</span>
							</button>

							{stylePickerOpen && (
								<div className="style-dropdown">
									<div className="style-inline-row">
										<button
											className={`style-inline-btn${editor.isActive("bold") ? " active" : ""}`}
											onMouseDown={(e) => {
												e.preventDefault();
												editor.chain().focus().toggleBold().run();
											}}
										>
											<span className="style-inline-bold">B</span>
										</button>
										<button
											className={`style-inline-btn${editor.isActive("italic") ? " active" : ""}`}
											onMouseDown={(e) => {
												e.preventDefault();
												editor.chain().focus().toggleItalic().run();
											}}
										>
											<span className="style-inline-italic">I</span>
										</button>
										<button
											className={`style-inline-btn${editor.isActive("underline") ? " active" : ""}`}
											onMouseDown={(e) => {
												e.preventDefault();
												editor.chain().focus().toggleUnderline().run();
											}}
										>
											<span className="style-inline-underline">U</span>
										</button>
										<button
											className={`style-inline-btn${editor.isActive("strike") ? " active" : ""}`}
											onMouseDown={(e) => {
												e.preventDefault();
												editor.chain().focus().toggleStrike().run();
											}}
										>
											<span className="style-inline-strike">S</span>
										</button>
									</div>
									<div className="style-dropdown-divider" />
									{BLOCK_STYLES.map(
										({ value, label, prefix, dividerBefore }) => {
											const isActive = activeStyle() === value;
											return (
												<React.Fragment key={value}>
													{dividerBefore && (
														<div className="style-dropdown-divider" />
													)}
													<button
														className={`style-option${isActive ? " active" : ""}`}
														onMouseDown={(e) => {
															e.preventDefault();
															applyStyle(value);
														}}
													>
														<span className="style-check">
															{isActive ? "✓" : ""}
														</span>
														<span
															className={`style-label style-label-${value}`}
														>
															{prefix && (
																<span className="style-prefix">{prefix}</span>
															)}
															{label}
														</span>
													</button>
												</React.Fragment>
											);
										},
									)}
								</div>
							)}
						</div>

						<button
							className={btn(false)}
							onMouseDown={(e) => {
								e.preventDefault();
								editor.chain().focus().toggleTaskList().run();
							}}
							title="Checklist"
						>
							<FontAwesomeIcon icon={faSquareCheck} />
						</button>

						<button
							className={btn(false)}
							onMouseDown={(e) => {
								e.preventDefault();
								editor
									.chain()
									.focus()
									.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
									.run();
							}}
							title="Table"
						>
							<FontAwesomeIcon icon={faTableCellsLarge} />
						</button>

						{/* ── Attachment menu ── */}
						<div className="attach-dropdown-wrap" ref={attachMenuRef}>
							<button
								className={btn(attachMenuOpen)}
								onClick={() => setAttachMenuOpen((v) => !v)}
								title="Attachments"
							>
								<FontAwesomeIcon icon={faPaperclip} />
							</button>

							{attachMenuOpen && (
								<div className="attach-dropdown">
									<button
										className="attach-option"
										onMouseDown={async (e) => {
											e.preventDefault();
											setAttachMenuOpen(false);
											if (!editor) return;
											const selected = await open({
												multiple: true,
												filters: [
													{
														name: "Images",
														extensions: [
															"png",
															"jpg",
															"jpeg",
															"gif",
															"webp",
															"bmp",
															"svg",
															"heic",
														],
													},
												],
											});
											if (!selected) return;
											const paths = Array.isArray(selected)
												? selected
												: [selected];
											for (const filePath of paths) {
												const file = await readPathAsFile(
													filePath,
													imageMimeMap,
												);
												const src = await resolveImage.current!(file);
												editor.chain().focus().setImage({ src }).run();
											}
										}}
									>
										<FontAwesomeIcon
											icon={faImage}
											className="attach-option-icon"
										/>
										<span>Attach Photo</span>
									</button>
									<button
										className="attach-option"
										onMouseDown={async (e) => {
											e.preventDefault();
											setAttachMenuOpen(false);
											if (!editor) return;
											const selected = await open({
												multiple: true,
												filters: [
													{ name: "PDF Documents", extensions: ["pdf"] },
												],
											});
											if (!selected) return;
											const paths = Array.isArray(selected)
												? selected
												: [selected];
											for (const filePath of paths) {
												const file = await readPathAsFile(filePath, {
													pdf: "application/pdf",
												});
												const result = await resolveFile.current!(file);
												if (result) {
													editor
														.chain()
														.focus()
														.insertContent({
															type: "fileAttachment",
															attrs: result,
														})
														.run();
												}
											}
										}}
									>
										<FontAwesomeIcon
											icon={faFilePdf}
											className="attach-option-icon"
										/>
										<span>Attach PDF</span>
									</button>
								</div>
							)}
						</div>
					</div>
				)}

				<div className="toolbar-spacer" />

				{onShare && !readOnly && (
					<button
						className={btn(false)}
						onMouseDown={(e) => {
							e.preventDefault();
							onShare();
						}}
						title="Share Note"
					>
						<FontAwesomeIcon icon={faUserPlus} />
					</button>
				)}

				{onLeaveShared && (
					<button
						className={btn(false, "toolbar-btn-danger")}
						onMouseDown={(e) => {
							e.preventDefault();
							onLeaveShared();
						}}
						title="Leave Shared Note"
					>
						<FontAwesomeIcon icon={faRightFromBracket} />
					</button>
				)}

				{!readOnly && !onLeaveShared && (
					<button
						className={btn(false, "toolbar-btn-danger")}
						onMouseDown={(e) => {
							e.preventDefault();
							onDelete();
						}}
						title="Delete Note"
					>
						<FontAwesomeIcon icon={faTrash} />
					</button>
				)}
			</div>

			{findOpen &&
				(() => {
					const matches = findAllMatches(editor.state.doc, findQuery);
					const safeIndex =
						matches.length > 0 ? Math.min(findIndex, matches.length - 1) : 0;
					return (
						<div className="find-bar">
							<FontAwesomeIcon
								icon={faMagnifyingGlass}
								className="find-bar-icon"
							/>
							<input
								ref={findInputRef}
								className="find-bar-input"
								value={findQuery}
								placeholder="Find in note…"
								onChange={(e) => {
									const q = e.target.value;
									setFindQuery(q);
									setFindIndex(0);
									dispatchSearch(q, 0);
								}}
								onKeyDown={(e) => {
									if (e.key === "Escape") closeFindBar();
									else if (e.key === "Enter") {
										e.preventDefault();
										navigateFind(e.shiftKey ? -1 : 1);
									}
								}}
							/>
							{findQuery && (
								<span className="find-bar-counter">
									{matches.length > 0
										? `${safeIndex + 1}/${matches.length}`
										: "0/0"}
								</span>
							)}
							<button
								className="find-bar-btn"
								onMouseDown={(e) => {
									e.preventDefault();
									navigateFind(-1);
								}}
								title="Previous match (Shift+Enter)"
							>
								<FontAwesomeIcon icon={faChevronUp} />
							</button>
							<button
								className="find-bar-btn"
								onMouseDown={(e) => {
									e.preventDefault();
									navigateFind(1);
								}}
								title="Next match (Enter)"
							>
								<FontAwesomeIcon icon={faChevronDown} />
							</button>
							<button
								className="find-bar-btn find-bar-close"
								onMouseDown={(e) => {
									e.preventDefault();
									closeFindBar();
								}}
								title="Close (Esc)"
							>
								<FontAwesomeIcon icon={faXmark} />
							</button>
						</div>
					);
				})()}

			<div className="editor-timestamp">{formatTimestamp(note.updated_at)}</div>
			{creatorName && (
				<div className="editor-created-by">Created by {creatorName}</div>
			)}

			<div className="editor-scroll-area" ref={editorScrollRef}>
				<EditorContent editor={editor} className="editor" />

				{editor.isActive("table") && (
					<TableFloatingToolbar editor={editor} scrollRef={editorScrollRef} />
				)}
			</div>
		</div>
	);
}

function TableFloatingToolbar({
	editor,
	scrollRef,
}: {
	editor: ReturnType<typeof useEditor>;
	scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
	const toolbarRef = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

	useEffect(() => {
		if (!editor) return;

		function update() {
			if (!editor || !scrollRef.current) return;
			const tableNode = editor.view.dom.querySelector("table");
			if (!tableNode) {
				setPos(null);
				return;
			}

			const { $from } = editor.state.selection;
			let tableEl: HTMLElement | null = null;
			for (let d = $from.depth; d > 0; d--) {
				if ($from.node(d).type.name === "table") {
					const domNode = editor.view.nodeDOM($from.before(d));
					if (domNode instanceof HTMLElement) {
						tableEl = domNode.querySelector("table") || domNode;
					}
					break;
				}
			}
			if (!tableEl) {
				setPos(null);
				return;
			}

			const scrollRect = scrollRef.current.getBoundingClientRect();
			const tableRect = tableEl.getBoundingClientRect();

			setPos({
				top:
					tableRect.bottom - scrollRect.top + scrollRef.current.scrollTop + 4,
				left: tableRect.left - scrollRect.left + scrollRef.current.scrollLeft,
			});
		}

		update();
		editor.on("selectionUpdate", update);
		editor.on("update", update);

		const scrollEl = scrollRef.current;
		scrollEl?.addEventListener("scroll", update, { passive: true });

		return () => {
			editor.off("selectionUpdate", update);
			editor.off("update", update);
			scrollEl?.removeEventListener("scroll", update);
		};
	}, [editor, scrollRef]);

	if (!editor || !pos) return null;

	const act = (fn: () => boolean) => (e: React.MouseEvent) => {
		e.preventDefault();
		fn();
	};

	return (
		<div
			className="table-toolbar"
			ref={toolbarRef}
			style={{ top: pos.top, left: pos.left }}
		>
			<div className="table-toolbar-group">
				<button
					className="table-toolbar-btn"
					onMouseDown={act(() => editor.chain().focus().addRowBefore().run())}
					title="Add row above"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<path
							d="M8 3v10M3 8h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
						<path
							d="M2 13h12"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							opacity="0.4"
						/>
					</svg>
					<span className="table-toolbar-label">Row above</span>
				</button>
				<button
					className="table-toolbar-btn"
					onMouseDown={act(() => editor.chain().focus().addRowAfter().run())}
					title="Add row below"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<path
							d="M8 3v10M3 8h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
						<path
							d="M2 3h12"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							opacity="0.4"
						/>
					</svg>
					<span className="table-toolbar-label">Row below</span>
				</button>
				<button
					className="table-toolbar-btn table-toolbar-btn-danger"
					onMouseDown={act(() => editor.chain().focus().deleteRow().run())}
					title="Delete row"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<path
							d="M3 8h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
					<span className="table-toolbar-label">Delete row</span>
				</button>
			</div>

			<div className="table-toolbar-divider" />

			<div className="table-toolbar-group">
				<button
					className="table-toolbar-btn"
					onMouseDown={act(() =>
						editor.chain().focus().addColumnBefore().run(),
					)}
					title="Add column left"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<path
							d="M8 3v10M3 8h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
						<path
							d="M13 2v12"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							opacity="0.4"
						/>
					</svg>
					<span className="table-toolbar-label">Col left</span>
				</button>
				<button
					className="table-toolbar-btn"
					onMouseDown={act(() => editor.chain().focus().addColumnAfter().run())}
					title="Add column right"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<path
							d="M8 3v10M3 8h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
						<path
							d="M3 2v12"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							opacity="0.4"
						/>
					</svg>
					<span className="table-toolbar-label">Col right</span>
				</button>
				<button
					className="table-toolbar-btn table-toolbar-btn-danger"
					onMouseDown={act(() => editor.chain().focus().deleteColumn().run())}
					title="Delete column"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<path
							d="M3 8h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
					<span className="table-toolbar-label">Delete col</span>
				</button>
			</div>

			<div className="table-toolbar-divider" />

			<div className="table-toolbar-group">
				<button
					className="table-toolbar-btn"
					onMouseDown={act(() =>
						editor.chain().focus().toggleHeaderRow().run(),
					)}
					title="Toggle header row"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<rect
							x="2"
							y="3"
							width="12"
							height="10"
							rx="1.5"
							stroke="currentColor"
							strokeWidth="1.3"
						/>
						<path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.3" />
					</svg>
					<span className="table-toolbar-label">Header</span>
				</button>
				<button
					className="table-toolbar-btn"
					onMouseDown={act(() => editor.chain().focus().mergeCells().run())}
					title="Merge cells"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<rect
							x="2"
							y="3"
							width="12"
							height="10"
							rx="1.5"
							stroke="currentColor"
							strokeWidth="1.3"
						/>
						<path
							d="M5.5 8h5M8.5 5.5L10.5 8l-2 2.5"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
					<span className="table-toolbar-label">Merge</span>
				</button>
				<button
					className="table-toolbar-btn"
					onMouseDown={act(() => editor.chain().focus().splitCell().run())}
					title="Split cell"
				>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
						<rect
							x="2"
							y="3"
							width="12"
							height="10"
							rx="1.5"
							stroke="currentColor"
							strokeWidth="1.3"
						/>
						<path
							d="M10.5 8h-5M5.5 5.5L3.5 8l2 2.5"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
					<span className="table-toolbar-label">Split</span>
				</button>
			</div>

			<div className="table-toolbar-divider" />

			<button
				className="table-toolbar-btn table-toolbar-btn-danger"
				onMouseDown={act(() => editor.chain().focus().deleteTable().run())}
				title="Delete table"
			>
				<FontAwesomeIcon icon={faTrash} style={{ fontSize: 12 }} />
				<span className="table-toolbar-label">Delete table</span>
			</button>
		</div>
	);
}
