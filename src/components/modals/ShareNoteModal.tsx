import { useState, useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faUserPlus,
	faMagnifyingGlass,
	faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "../../types";

interface ShareNoteModalProps {
	noteId: string;
	supabaseClient: SupabaseClient;
	userId: string;
	onClose: () => void;
}

interface ShareEntry extends UserProfile {
	shared: boolean;
}

export function ShareNoteModal({
	noteId,
	supabaseClient,
	userId,
	onClose,
}: ShareNoteModalProps) {
	const [users, setUsers] = useState<ShareEntry[]>([]);
	const [searchQuery, setSearchQuery] = useState("");
	const [loading, setLoading] = useState(true);
	const [actionInFlight, setActionInFlight] = useState<string | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			const [profilesRes, sharesRes] = await Promise.all([
				supabaseClient
					.from("user_profiles")
					.select("display_name, avatar_num"),
				supabaseClient
					.from("note_sharing")
					.select("shared_with_id, users!note_sharing_shared_with_id_fkey(display_name)")
					.eq("note_id", noteId)
					.eq("owner_id", userId),
			]);

			if (cancelled) return;

			const sharedNames = new Set(
				(sharesRes.data ?? []).map(
					(s: Record<string, unknown>) => (s.users as Record<string, unknown> | null)?.display_name as string,
				).filter(Boolean),
			);

			const ownProfile = await supabaseClient
				.from("users")
				.select("display_name")
				.eq("user_id", userId)
				.maybeSingle();

			const ownName = ownProfile.data?.display_name;

			const entries: ShareEntry[] = (profilesRes.data ?? [])
				.filter((p) => p.display_name !== ownName)
				.map((p) => ({
					display_name: p.display_name as string,
					avatar_num: p.avatar_num as number | null,
					shared: sharedNames.has(p.display_name as string),
				}))
				.sort((a: ShareEntry, b: ShareEntry) => {
					if (a.shared !== b.shared) return a.shared ? -1 : 1;
					return a.display_name.localeCompare(b.display_name);
				});

			setUsers(entries);
			setLoading(false);
		}

		load();
		return () => { cancelled = true; };
	}, [noteId, supabaseClient, userId]);

	useEffect(() => {
		if (!loading && searchRef.current) {
			searchRef.current.focus();
		}
	}, [loading]);

	async function handleShare(displayName: string) {
		setActionInFlight(displayName);
		const { error } = await supabaseClient.rpc("share_note_with_user", {
			p_note_id: noteId,
			p_display_name: displayName,
		});
		if (!error) {
			setUsers((prev) =>
				prev.map((u) =>
					u.display_name === displayName ? { ...u, shared: true } : u,
				),
			);
		}
		setActionInFlight(null);
	}

	async function handleUnshare(displayName: string) {
		setActionInFlight(displayName);
		const { error } = await supabaseClient.rpc("unshare_note_with_user", {
			p_note_id: noteId,
			p_display_name: displayName,
		});
		if (!error) {
			setUsers((prev) =>
				prev.map((u) =>
					u.display_name === displayName ? { ...u, shared: false } : u,
				),
			);
		}
		setActionInFlight(null);
	}

	const trimmed = searchQuery.trim().toLowerCase();
	const filtered = trimmed
		? users.filter((u) => u.display_name.toLowerCase().includes(trimmed))
		: users;

	return (
		<div className="share-overlay" onMouseDown={onClose}>
			<div className="share-card" onMouseDown={(e) => e.stopPropagation()}>
				<button type="button" className="share-close" onClick={onClose} aria-label="Close">
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

				<div className="share-header">
					<FontAwesomeIcon icon={faUserPlus} className="share-header-icon" />
					<span className="share-header-title">Share Note</span>
				</div>

				<div className="share-search-wrap">
					<FontAwesomeIcon
						icon={faMagnifyingGlass}
						className="share-search-icon"
					/>
					<input
						ref={searchRef}
						className="share-search-input"
						type="text"
						placeholder="Search users…"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								if (searchQuery) setSearchQuery("");
								else onClose();
							}
						}}
					/>
					{searchQuery && (
						<button
							type="button"
							className="share-search-clear"
							onClick={() => setSearchQuery("")}
						>
							<FontAwesomeIcon icon={faXmark} />
						</button>
					)}
				</div>

				<div className="share-user-list">
					{loading ? (
						<p className="share-empty">Loading users…</p>
					) : filtered.length === 0 ? (
						<p className="share-empty">
							{trimmed ? "No users found" : "No other users"}
						</p>
					) : (
						filtered.map((u) => (
							<div key={u.display_name} className="share-user-row">
								<div className="share-user-avatar">
									{u.avatar_num ? (
										<img
											src={`/avatars/avatar_${u.avatar_num}.png`}
											alt={u.display_name}
											className="share-user-avatar-img"
										/>
									) : (
										<svg
											viewBox="0 0 32 32"
											fill="none"
											xmlns="http://www.w3.org/2000/svg"
										>
											<circle
												cx="16"
												cy="12"
												r="6"
												fill="currentColor"
												opacity="0.55"
											/>
											<path
												d="M4 28c0-6.627 5.373-12 12-12s12 5.373 12 12"
												fill="currentColor"
												opacity="0.35"
											/>
										</svg>
									)}
								</div>
								<span className="share-user-name">{u.display_name}</span>
								{u.shared ? (
									<button
										type="button"
										className="share-action-btn share-action-unshare"
										disabled={actionInFlight === u.display_name}
										onClick={() => handleUnshare(u.display_name)}
									>
										{actionInFlight === u.display_name
											? "…"
											: "Unshare"}
									</button>
								) : (
									<button
										type="button"
										className="share-action-btn share-action-share"
										disabled={actionInFlight === u.display_name}
										onClick={() => handleShare(u.display_name)}
									>
										{actionInFlight === u.display_name
											? "…"
											: "Share"}
									</button>
								)}
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}
