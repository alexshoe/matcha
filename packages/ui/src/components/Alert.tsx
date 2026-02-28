import React from "react";

export type AlertVariant = "default" | "error" | "shared";

interface AlertProps {
	/** The message to display. Pass null/undefined to hide the alert. */
	message: string | null | undefined;
	/** Visual variant — default (info), error, or shared-note. */
	variant?: AlertVariant;
	/** Optional title shown above the message (used for "shared" variant). */
	title?: string;
	/** Called when the × dismiss button is clicked. */
	onDismiss: () => void;
	/** Optional click handler for the whole alert (shared variant uses this to navigate). */
	onClick?: () => void;
}

/**
 * Matcha Alert — shadcn-inspired notification component.
 *
 * Replaces the old toast system with a fully interactable alert that has
 * a dismiss button and optional click action. Positioned fixed on screen.
 */
export function Alert({
	message,
	variant = "default",
	title,
	onDismiss,
	onClick,
}: AlertProps) {
	if (!message) return null;

	const isShared = variant === "shared";
	const isClickable = isShared && !!onClick;

	return (
		<div
			className={`matcha-alert-container matcha-alert-container--${variant}`}
			role="alert"
			aria-live="polite"
		>
			<div
				className={[
					"matcha-alert",
					`matcha-alert--${variant}`,
					isClickable ? "matcha-alert--clickable" : "",
				]
					.filter(Boolean)
					.join(" ")}
				onClick={isClickable ? onClick : undefined}
			>
				{isShared && title && (
					<div className="matcha-alert__title">{title}</div>
				)}
				<div className="matcha-alert__body">
					<span className="matcha-alert__message">{message}</span>
					<button
						className="matcha-alert__dismiss"
						onClick={(e) => {
							e.stopPropagation();
							onDismiss();
						}}
						aria-label="Dismiss"
						type="button"
					>
						×
					</button>
				</div>
			</div>
		</div>
	);
}
