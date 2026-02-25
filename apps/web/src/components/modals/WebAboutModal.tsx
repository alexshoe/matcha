interface Props {
	onClose: () => void;
}

export function WebAboutModal({ onClose }: Props) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: overlay backdrop
		// biome-ignore lint/a11y/useKeyWithClickEvents: overlay backdrop
		<div className="about-overlay" onClick={onClose}>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: modal card stop-propagation */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: modal card stop-propagation */}
			<div
				className="about-card-wrap"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="about-card">
					<button
						type="button"
						className="about-close"
						onClick={onClose}
						aria-label="Close"
					>
						<svg
							viewBox="0 0 16 16"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
							width="14"
							height="14"
							aria-hidden="true"
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
							alt="Matcha logo"
							width="110"
							height="60"
						/>
					</div>
					<h1 className="about-name">matcha</h1>
					<p className="about-version">Version 0.1.0</p>
					<button
						type="button"
						className="about-author-link"
						onClick={() =>
							window.open("https://github.com/alexshoe", "_blank")
						}
					>
						Made by Alex Hsu
						<svg
							viewBox="0 0 16 16"
							fill="currentColor"
							width="14"
							height="14"
							aria-hidden="true"
						>
							<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
						</svg>
					</button>
				</div>
			</div>
		</div>
	);
}
