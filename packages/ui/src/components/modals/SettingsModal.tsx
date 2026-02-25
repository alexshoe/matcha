import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear } from "@fortawesome/free-solid-svg-icons";

export type SortNotesBy = "date_edited" | "date_created" | "title";
export type NewNoteStart = "title" | "heading" | "subheading" | "body";

interface SettingsModalProps {
	theme: "dark" | "matcha" | "light";
	setTheme: (theme: "dark" | "matcha" | "light") => void;
	sortNotesBy: SortNotesBy;
	setSortNotesBy: (val: SortNotesBy) => void;
	newNoteStartWith: NewNoteStart;
	setNewNoteStartWith: (val: NewNoteStart) => void;
	autoSortChecked: boolean;
	setAutoSortChecked: (val: boolean) => void;
	onClose: () => void;
}

export function SettingsModal({
	theme,
	setTheme,
	sortNotesBy,
	setSortNotesBy,
	newNoteStartWith,
	setNewNoteStartWith,
	autoSortChecked,
	setAutoSortChecked,
	onClose,
}: SettingsModalProps) {
	return (
		<div className="settings-overlay" onClick={onClose}>
			<div className="settings-card" onClick={(e) => e.stopPropagation()}>
				<button className="settings-close" onClick={onClose} aria-label="Close">
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
								Automatically move checklist items to the bottom of the list as
								they are checked.
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
	);
}
