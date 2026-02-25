export function formatDate(ts: number): string {
	const d = new Date(ts * 1000);
	const now = new Date();
	if (d.toDateString() === now.toDateString()) {
		return d.toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
		});
	}
	const yesterday = new Date(now);
	yesterday.setDate(yesterday.getDate() - 1);
	if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
	const diffDays = (now.getTime() - d.getTime()) / 86_400_000;
	if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(2)} MB`;
}
