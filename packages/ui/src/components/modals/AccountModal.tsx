import { useState, useRef, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPencil } from "@fortawesome/free-solid-svg-icons";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { validatePassword, sanitizeAuthError } from "../AuthPage";

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

interface AccountModalProps {
	user: User | null;
	displayName: string;
	avatarNum: number | null;
	storageUsedLabel: string;
	supabaseClient: SupabaseClient | null;
	onDisplayNameSaved: (name: string) => void;
	onAvatarSaved: (num: number) => void;
	onManualSync: () => Promise<void>;
	onSignOut: () => void;
	onClose: () => void;
}

export function AccountModal({
	user,
	displayName,
	avatarNum,
	storageUsedLabel,
	supabaseClient,
	onDisplayNameSaved,
	onAvatarSaved,
	onManualSync,
	onClose,
}: AccountModalProps) {
	const [editingDisplayName, setEditingDisplayName] = useState(false);
	const [displayNameValue, setDisplayNameValue] = useState(displayName);
	const displayNameInputRef = useRef<HTMLInputElement>(null);
	const [editingPassword, setEditingPassword] = useState(false);
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [passwordError, setPasswordError] = useState<string | null>(null);
	const [passwordSaving, setPasswordSaving] = useState(false);
	const [showNewPassword, setShowNewPassword] = useState(false);
	const [showConfirmPassword, setShowConfirmPassword] = useState(false);
	const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
	const [pendingAvatarNum, setPendingAvatarNum] = useState<number | null>(null);
	const [syncing, setSyncing] = useState(false);
	const [syncDone, setSyncDone] = useState(false);

	useEffect(() => {
		if (editingDisplayName && displayNameInputRef.current) {
			displayNameInputRef.current.focus();
			displayNameInputRef.current.select();
		}
	}, [editingDisplayName]);

	function handleClose() {
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
		onClose();
	}

	async function saveDisplayName(newName: string) {
		const trimmed = newName.trim() || displayName;
		setEditingDisplayName(false);
		setDisplayNameValue(trimmed);
		onDisplayNameSaved(trimmed);
		if (supabaseClient) {
			const { error } = await supabaseClient.auth.updateUser({
				data: { display_name: trimmed },
			});
			if (error) console.warn("Failed to update display name:", error.message);

			if (user) {
				const { error: dbError } = await supabaseClient
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
		const pwError = validatePassword(newPassword);
		if (pwError) {
			setPasswordError(pwError);
			return;
		}
		if (newPassword !== confirmPassword) {
			setPasswordError("Passwords don't match.");
			return;
		}
		setPasswordError(null);
		setPasswordSaving(true);
		try {
			if (!supabaseClient) throw new Error("Not connected.");
			const { error } = await supabaseClient.auth.updateUser({
				password: newPassword,
			});
			if (error) {
				setPasswordError(sanitizeAuthError(error.message));
			} else {
				setEditingPassword(false);
				setNewPassword("");
				setConfirmPassword("");
			}
		} finally {
			setPasswordSaving(false);
		}
	}

	function closeAvatarPicker() {
		setAvatarPickerOpen(false);
		setPendingAvatarNum(null);
	}

	async function saveAvatar(num: number) {
		setAvatarPickerOpen(false);
		setPendingAvatarNum(null);
		onAvatarSaved(num);
		if (supabaseClient && user) {
			const { error } = await supabaseClient
				.from("users")
				.update({ avatar_num: num })
				.eq("user_id", user.id);
			if (error) console.warn("Failed to update avatar:", error.message);
		}
	}

	const PasswordToggle = ({
		show,
		onToggle,
		disabled,
	}: {
		show: boolean;
		onToggle: () => void;
		disabled?: boolean;
	}) => (
		<button
			className="account-password-toggle"
			onClick={onToggle}
			tabIndex={-1}
			title="Reveal"
			aria-label={show ? "Hide password" : "Reveal password"}
			disabled={disabled}
		>
			{!show ? (
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
	);

	return (
		<div className="account-overlay" onClick={handleClose}>
			<div
				className={`account-card-wrap${avatarPickerOpen ? " picker-open" : ""}`}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="account-card">
					<button
						className="account-close"
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
									ref={displayNameInputRef}
									className="account-password-input"
									placeholder="Enter new display name"
									value={displayNameValue}
									onChange={(e) => setDisplayNameValue(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") saveDisplayName(displayNameValue);
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
							<span className="account-row-value">{user?.email ?? "—"}</span>
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
										onKeyDown={(e) => e.key === "Enter" && handlePasswordSave()}
										disabled={passwordSaving}
										autoFocus
									/>
									<PasswordToggle
										show={showNewPassword}
										onToggle={() => setShowNewPassword((v) => !v)}
										disabled={passwordSaving}
									/>
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
										onKeyDown={(e) => e.key === "Enter" && handlePasswordSave()}
										disabled={passwordSaving}
									/>
									<PasswordToggle
										show={showConfirmPassword}
										onToggle={() => setShowConfirmPassword((v) => !v)}
										disabled={passwordSaving}
									/>
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
						<div className="account-row account-row-center">
							<button
								className="account-sync-btn"
								disabled={syncing}
								onClick={async () => {
									setSyncing(true);
									setSyncDone(false);
									try {
										await onManualSync();
										setSyncDone(true);
										setTimeout(() => setSyncDone(false), 2000);
									} finally {
										setSyncing(false);
									}
								}}
							>
								{syncing ? (
									<>
										<svg
											className="account-sync-spinner"
											viewBox="0 0 16 16"
											width="13"
											height="13"
										>
											<circle
												cx="8"
												cy="8"
												r="6"
												stroke="currentColor"
												strokeWidth="2"
												fill="none"
												strokeDasharray="28"
												strokeDashoffset="8"
												strokeLinecap="round"
											/>
										</svg>
										Syncing…
									</>
								) : syncDone ? (
									<>
										<svg viewBox="0 0 16 16" width="13" height="13" fill="none">
											<path
												d="M3 8.5l3.5 3.5 6.5-7"
												stroke="currentColor"
												strokeWidth="1.8"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
										Synced
									</>
								) : (
									<>
										<svg viewBox="0 0 16 16" width="13" height="13" fill="none">
											<path
												d="M2.5 8a5.5 5.5 0 0 1 9.3-4"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
											/>
											<path
												d="M13.5 8a5.5 5.5 0 0 1-9.3 4"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
											/>
											<path
												d="M11 2.5l1 1.7 1.7-.5"
												stroke="currentColor"
												strokeWidth="1.3"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
											<path
												d="M5 13.5l-1-1.7-1.7.5"
												stroke="currentColor"
												strokeWidth="1.3"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
										Sync now
									</>
								)}
							</button>
						</div>
					</div>
				</div>

				<div className="avatar-picker-panel">
					<div className="avatar-picker-header">
						<span className="avatar-picker-title">Choose Avatar</span>
						<button
							className="avatar-picker-close"
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
					</div>
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
					<div className="avatar-picker-actions">
						<button
							className="avatar-picker-cancel-btn"
							onClick={closeAvatarPicker}
						>
							Cancel
						</button>
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
		</div>
	);
}
