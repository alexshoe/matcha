import type React from "react";
import { extractAllText } from "./noteContent";

export function getSearchSnippet(
	content: string,
	query: string,
): { before: string; match: string; after: string } | null {
	const allText = extractAllText(content);
	if (!allText || !query) return null;
	const lower = allText.toLowerCase();
	const lowerQ = query.toLowerCase();
	const idx = lower.indexOf(lowerQ);
	if (idx === -1) return null;
	const start = Math.max(0, idx - 30);
	const end = Math.min(allText.length, idx + query.length + 40);
	return {
		before: (start > 0 ? "\u2026" : "") + allText.slice(start, idx),
		match: allText.slice(idx, idx + query.length),
		after:
			allText.slice(idx + query.length, end) +
			(end < allText.length ? "\u2026" : ""),
	};
}

export function highlightText(text: string, query: string): React.ReactNode {
	if (!query) return text;
	const lower = text.toLowerCase();
	const lowerQ = query.toLowerCase();
	const parts: React.ReactNode[] = [];
	let lastIdx = 0;
	let idx = lower.indexOf(lowerQ);
	let key = 0;
	while (idx !== -1) {
		if (idx > lastIdx) parts.push(text.slice(lastIdx, idx));
		parts.push(
			<mark className="search-highlight" key={key++}>
				{text.slice(idx, idx + query.length)}
			</mark>,
		);
		lastIdx = idx + query.length;
		idx = lower.indexOf(lowerQ, lastIdx);
	}
	if (lastIdx < text.length) parts.push(text.slice(lastIdx));
	return parts.length > 0 ? <>{parts}</> : text;
}
