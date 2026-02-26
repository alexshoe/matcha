import { Extension, InputRule } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

function isProbablyUrl(s: string): boolean {
	const t = s.trim();
	if (!t) return false;
	try {
		const u = new URL(t.includes("://") ? t : `https://${t}`);
		return Boolean(u.hostname) && u.hostname.includes(".");
	} catch {
		return false;
	}
}

function normalizeUrl(s: string): string {
	const t = s.trim();
	return t.includes("://") ? t : `https://${t}`;
}

const pasteUrlKey = new PluginKey("pasteUrlToLink");

/**
 * Two hyperlink conveniences in one extension:
 *
 * 1. Paste-to-link: select text, paste a URL → applies a link mark instead of
 *    replacing the selection with the raw URL text.
 *
 * 2. Markdown input rule: type [label](url) → converts to linked text inline.
 */
export const PasteUrlToLink = Extension.create({
	name: "pasteUrlToLink",

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: pasteUrlKey,
				props: {
					handlePaste(view, event) {
						const text =
							event.clipboardData?.getData("text/plain") ?? "";
						if (!isProbablyUrl(text)) return false;

						const { state, dispatch } = view;
						const { from, to, empty } = state.selection;
						if (empty) return false; // only when text is selected

						const href = normalizeUrl(text);
						const linkMark = state.schema.marks.link;
						if (!linkMark) return false;

						const tr = state.tr
							.addMark(from, to, linkMark.create({ href }))
							.setMeta("addToHistory", true);

						dispatch(tr);
						return true;
					},
				},
			}),
		];
	},

	addInputRules() {
		// [label](url) → replace with linked text
		return [
			new InputRule({
				find: /\[([^\[\]]+)\]\((\S+)\)$/,
				handler: ({ state, range, match }) => {
					const label = match[1];
					const href = normalizeUrl(match[2]);
					const linkMark = state.schema.marks.link;
					if (!linkMark) return null;

					state.tr.replaceWith(
						range.from,
						range.to,
						state.schema.text(label, [linkMark.create({ href })]),
					);
				},
			}),
		];
	},
});
