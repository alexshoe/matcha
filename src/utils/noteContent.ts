function getBlockText(block: any): string {
	if (!block) return "";
	if (block.type === "text") return block.text ?? "";
	return (block.content ?? []).map(getBlockText).join("");
}

export function extractPreview(content: string): { title: string; preview: string } {
	if (!content) return { title: "", preview: "" };
	try {
		const doc = JSON.parse(content);
		const blocks: any[] = doc.content ?? [];
		let title = "";
		let titleIdx = -1;
		for (let i = 0; i < blocks.length; i++) {
			const text = getBlockText(blocks[i]).trim();
			if (text) {
				title = text;
				titleIdx = i;
				break;
			}
		}
		let preview = "";
		for (let i = titleIdx + 1; i < blocks.length; i++) {
			const text = getBlockText(blocks[i]).trim();
			if (text) {
				preview = text;
				break;
			}
		}
		return { title, preview };
	} catch {
		return { title: "", preview: "" };
	}
}

export function extractAllText(content: string): string {
	if (!content) return "";
	try {
		const doc = JSON.parse(content);
		const blocks: any[] = doc.content ?? [];
		return blocks
			.map((b) => getBlockText(b).trim())
			.filter(Boolean)
			.join(" ");
	} catch {
		return "";
	}
}

export function isNoteEmpty(content: string): boolean {
	if (!content) return true;
	try {
		const doc = JSON.parse(content);
		const blocks: any[] = doc.content ?? [];
		const hasContent = (node: any): boolean => {
			if (!node) return false;
			if (node.type === "text" && node.text?.trim()) return true;
			if (node.type === "image" || node.type === "resizableImage") return true;
			if (node.type === "fileAttachment") return true;
			if (node.content?.some(hasContent)) return true;
			return false;
		};
		return !blocks.some(hasContent);
	} catch {
		return true;
	}
}
