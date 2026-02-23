import { useState } from "react";
import { makeSupabaseClient, supabase } from "../lib/supabase";
import type { SupabaseClient, User } from "@supabase/supabase-js";

type LoginState = "idle" | "loading" | "success" | "exiting";
type AuthMode = "login" | "signup" | "forgot" | "reset";

function validatePassword(pw: string): string | null {
	if (pw.length < 8) return "Password must be at least 8 characters.";
	if (!/[A-Z]/.test(pw)) return "Password must include an uppercase letter.";
	if (!/[0-9]/.test(pw)) return "Password must include a number.";
	if (!/[^A-Za-z0-9]/.test(pw))
		return "Password must include a special character.";
	return null;
}

const rateLimitTimestamps: Record<string, number> = {};
function isRateLimited(key: string, cooldownMs: number): boolean {
	const now = Date.now();
	if (rateLimitTimestamps[key] && now - rateLimitTimestamps[key] < cooldownMs)
		return true;
	rateLimitTimestamps[key] = now;
	return false;
}

function sanitizeAuthError(message: string): string {
	const map: Record<string, string> = {
		"Invalid login credentials": "Incorrect email or password.",
		"Email not confirmed": "Please confirm your email before signing in.",
		"User already registered": "An account with this email already exists.",
		"Password should be at least 6 characters":
			"Password does not meet requirements.",
	};
	return map[message] ?? "Something went wrong. Please try again.";
}

export { validatePassword, isRateLimited, sanitizeAuthError };

export function AuthPage({
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
	const [otpToken, setOtpToken] = useState("");
	const [resetPassword, setResetPassword] = useState("");
	const [resetConfirm, setResetConfirm] = useState("");
	const [showResetPassword, setShowResetPassword] = useState(false);
	const [showResetConfirm, setShowResetConfirm] = useState(false);

	const busy = loginState !== "idle";

	function resetMessages() {
		setError(null);
		setInfoMessage(null);
	}

	function switchMode(next: AuthMode) {
		resetMessages();
		setSignUpDisplayName("");
		setOtpToken("");
		setResetPassword("");
		setResetConfirm("");
		setShowResetPassword(false);
		setShowResetConfirm(false);
		setMode(next);
	}

	async function handleLogin() {
		if (busy || !email.trim() || !password) return;
		if (isRateLimited("login", 2000)) {
			setError("Please wait a moment before trying again.");
			return;
		}
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
			setError(sanitizeAuthError(authError?.message ?? ""));
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
		if (isRateLimited("signup", 2000)) {
			setError("Please wait a moment before trying again.");
			return;
		}
		resetMessages();

		const pwError = validatePassword(password);
		if (pwError) {
			setError(pwError);
			return;
		}

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
			setError(sanitizeAuthError(authError.message));
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
			setError(sanitizeAuthError(authError.message));
		} else {
			setMode("reset");
			setInfoMessage("Check your email for an 8-digit reset code.");
		}
	}

	async function handleResetWithOtp() {
		if (busy) return;
		if (!otpToken.trim()) {
			setError("Enter the 8-digit code from your email.");
			return;
		}
		const pwError = validatePassword(resetPassword);
		if (pwError) {
			setError(pwError);
			return;
		}
		if (resetPassword !== resetConfirm) {
			setError("Passwords don't match.");
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
		const { error: verifyError } = await client.auth.verifyOtp({
			email: email.trim(),
			token: otpToken.trim(),
			type: "recovery",
		});
		if (verifyError) {
			setError(
				verifyError.message.includes("expired")
					? "Code has expired. Please request a new one."
					: sanitizeAuthError(verifyError.message),
			);
			setLoginState("idle");
			return;
		}
		const { error: updateError } = await client.auth.updateUser({
			password: resetPassword,
		});
		if (updateError) {
			setError(sanitizeAuthError(updateError.message));
			setLoginState("idle");
			return;
		}
		setLoginState("idle");
		setMode("login");
		setOtpToken("");
		setResetPassword("");
		setResetConfirm("");
		setInfoMessage("Password updated! Sign in with your new password.");
	}

	function handleSubmit() {
		if (mode === "login") handleLogin();
		else if (mode === "signup") handleSignUp();
		else if (mode === "reset") handleResetWithOtp();
		else handleForgotPassword();
	}

	const submitLabel =
		mode === "login"
			? "Sign in"
			: mode === "signup"
				? "Create account"
				: mode === "reset"
					? "Reset password"
					: "Send reset code";

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
					<img src="/matcha_logo_m.png" alt="Matcha" width="110" height="60" />
				</div>
				<h1 className="auth-title">matcha</h1>
				<div className="auth-form">
					{error && <div className="auth-error">{error}</div>}
					{infoMessage && <div className="auth-info">{infoMessage}</div>}
					{mode !== "reset" && (
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
					)}
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
					{mode === "reset" && (
						<>
							<div className="auth-field">
								<label className="auth-label">Reset code</label>
								<input
									className="auth-input auth-otp-input"
									type="text"
									inputMode="numeric"
									maxLength={8}
									placeholder="– – – – – – – –"
									value={otpToken}
									onChange={(e) =>
										setOtpToken(e.target.value.replace(/\D/g, ""))
									}
									onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
									disabled={busy}
								/>
							</div>
							<div className="auth-field">
								<label className="auth-label">New password</label>
								<div className="auth-input-wrapper">
									<input
										className="auth-input auth-input-password"
										type={showResetPassword ? "text" : "password"}
										placeholder="••••••••"
										value={resetPassword}
										onChange={(e) => setResetPassword(e.target.value)}
										onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
										disabled={busy}
									/>
									<button
										className="auth-password-toggle"
										onClick={() => setShowResetPassword((v) => !v)}
										tabIndex={-1}
										aria-label={
											showResetPassword ? "Hide password" : "Reveal password"
										}
										disabled={busy}
									>
										{!showResetPassword ? (
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
							<div className="auth-field">
								<label className="auth-label">Confirm password</label>
								<div className="auth-input-wrapper">
									<input
										className="auth-input auth-input-password"
										type={showResetConfirm ? "text" : "password"}
										placeholder="••••••••"
										value={resetConfirm}
										onChange={(e) => setResetConfirm(e.target.value)}
										onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
										disabled={busy}
									/>
									<button
										className="auth-password-toggle"
										onClick={() => setShowResetConfirm((v) => !v)}
										tabIndex={-1}
										aria-label={
											showResetConfirm ? "Hide password" : "Reveal password"
										}
										disabled={busy}
									>
										{!showResetConfirm ? (
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
						</>
					)}
					{mode !== "forgot" && mode !== "reset" && (
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
									{!showPassword ? (
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
					{mode === "forgot" || mode === "reset" ? (
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
