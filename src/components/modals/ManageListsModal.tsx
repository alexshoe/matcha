import { useState, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faFolder,
	faPen,
	faTrash,
	faPlus,
} from "@fortawesome/free-solid-svg-icons";

interface ManageListsModalProps {
	noteLists: string[];
	activeFolder: string;
	onAddList: (name: string) => void;
	onRemoveList: (idx: number) => void;
	onRenameList: (idx: number, newName: string) => void;
	onClose: () => void;
}

export function ManageListsModal({
	noteLists,
	activeFolder,
	onAddList,
	onRemoveList,
	onRenameList,
	onClose,
}: ManageListsModalProps) {
	const [newListName, setNewListName] = useState("");
	const [renamingListIdx, setRenamingListIdx] = useState<number | null>(null);
	const [renameListValue, setRenameListValue] = useState("");
	const renameListInputRef = useRef<HTMLInputElement>(null);
	const newListInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (renamingListIdx !== null && renameListInputRef.current) {
			renameListInputRef.current.focus();
			renameListInputRef.current.select();
		}
	}, [renamingListIdx]);

	function handleClose() {
		setRenamingListIdx(null);
		setRenameListValue("");
		setNewListName("");
		onClose();
	}

	function finishRename(idx: number, newName: string) {
		setRenamingListIdx(null);
		onRenameList(idx, newName);
	}

	return (
		<div className="manage-lists-overlay" onClick={handleClose}>
			<div
				className="manage-lists-card"
				onClick={(e) => e.stopPropagation()}
			>
				<button
					className="manage-lists-close"
					onClick={handleClose}
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
												finishRename(idx, renameListValue);
											else if (e.key === "Escape") setRenamingListIdx(null);
										}}
										onBlur={() => finishRename(idx, renameListValue)}
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
													onClick={() => onRemoveList(idx)}
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
								if (e.key === "Enter") {
									onAddList(newListName);
									setNewListName("");
								}
							}}
						/>
						<button
							className="manage-lists-add-btn"
							disabled={
								!newListName.trim() ||
								noteLists.includes(newListName.trim())
							}
							onClick={() => {
								onAddList(newListName);
								setNewListName("");
							}}
						>
							<FontAwesomeIcon icon={faPlus} />
							<span>Add</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
