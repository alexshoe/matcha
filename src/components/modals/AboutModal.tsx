import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBug, faEye, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isRateLimited } from "../AuthPage";

interface AboutModalProps {
	userRole: string;
	supabaseClient: SupabaseClient | null;
	user: User | null;
	onClose: () => void;
	onToast: (message: string, isError: boolean) => void;
}

export function AboutModal({
	userRole,
	supabaseClient,
	user,
	onClose,
	onToast,
}: AboutModalProps) {
	const [bugReportOpen, setBugReportOpen] = useState(false);
	const [viewBugsOpen, setViewBugsOpen] = useState(false);
	const [bugDescription, setBugDescription] = useState("");
	const [bugSteps, setBugSteps] = useState("");
	const [bugErrors, setBugErrors] = useState<{
		description?: boolean;
		steps?: boolean;
	}>({});
	const [bugSubmitting, setBugSubmitting] = useState(false);
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

	function handleClose() {
		setBugReportOpen(false);
		setViewBugsOpen(false);
		setBugDescription("");
		setBugSteps("");
		setBugErrors({});
		setBugSubmitting(false);
		setExpandedBugId(null);
		onClose();
	}

	async function fetchBugReports() {
		const db = supabaseClient;
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
		if (isRateLimited("bugReport", 10000)) {
			onToast("Please wait before submitting another report.", true);
			return;
		}
		const errors: { description?: boolean; steps?: boolean } = {};
		if (!bugDescription.trim()) errors.description = true;
		if (!bugSteps.trim()) errors.steps = true;
		if (Object.keys(errors).length > 0) {
			setBugErrors(errors);
			return;
		}
		setBugErrors({});
		setBugSubmitting(true);
		const db = supabaseClient;
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
		handleClose();
		onToast(errorMsg ?? "Thank you so much for reporting a bug 🐛", !!errorMsg);
	}

	return (
		<div className="about-overlay" onClick={handleClose}>
			<div
				className={`about-card-wrap${bugReportOpen ? " bug-report-open" : ""}${viewBugsOpen ? " view-bugs-open" : ""}`}
				onClick={(e) => e.stopPropagation()}
			>
				<div className="about-card">
					<button
						className="about-close"
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
					<div className="about-logo">
						<img
							src="/matcha_logo_m.png"
							alt="Matcha"
							width="120"
							height="120"
						/>
					</div>
					<h1 className="about-name">matcha</h1>
					<p className="about-version">Version 1.0.0</p>
					<button
						className="about-author-link"
						onClick={() => openUrl("https://github.com/alexshoe")}
					>
						Made by Alex Hsu
						<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
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
						<FontAwesomeIcon icon={faBug} className="about-bug-report-icon" />
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
							<FontAwesomeIcon icon={faEye} className="about-bug-report-icon" />
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
						{bugSubmitting ? <span className="auth-btn-spinner" /> : "Submit"}
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
										onClick={() => setExpandedBugId(isExpanded ? null : key)}
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
	);
}
