import { TaskItem } from "@tiptap/extension-task-item";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";

const INDENT_PX = 28;

export const DraggableTaskItem = TaskItem.extend({
	draggable: true,

	addNodeView() {
		return ({
			node: initialNode,
			getPos,
			editor,
		}: {
			node: PmNode;
			getPos: () => number | undefined;
			editor: Editor;
		}) => {
			let currentNode = initialNode;

			const li = document.createElement("li");
			li.dataset.type = "taskItem";

			const dragHandle = document.createElement("div");
			dragHandle.className = "task-drag-handle";
			dragHandle.contentEditable = "false";

			const label = document.createElement("label");
			label.contentEditable = "false";

			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";

			checkbox.addEventListener("change", (event) => {
				if (!editor.isEditable) {
					checkbox.checked = currentNode.attrs.checked;
					return;
				}
				const checked = (event.target as HTMLInputElement).checked;
				editor
					.chain()
					.command(({ tr }: { tr: Transaction }) => {
						const pos = getPos();
						if (typeof pos !== "number") return false;
						tr.setNodeMarkup(pos, undefined, {
							...currentNode.attrs,
							checked,
						});
						return true;
					})
					.run();
			});

			const checkSpan = document.createElement("span");
			label.append(checkbox, checkSpan);

			const content = document.createElement("div");

			li.append(dragHandle, label, content);

			function applyAttrs(attrs: Record<string, unknown>) {
				li.dataset.checked = attrs.checked ? "true" : "false";
				checkbox.checked = !!attrs.checked;
				if (attrs.indent) {
					li.setAttribute("data-indent", String(attrs.indent));
					li.style.marginLeft = `${Number(attrs.indent) * INDENT_PX}px`;
				} else {
					li.removeAttribute("data-indent");
					li.style.marginLeft = "";
				}
			}

			applyAttrs(currentNode.attrs);

			return {
				dom: li,
				contentDOM: content,
				update(updatedNode: PmNode) {
					if (updatedNode.type.name !== "taskItem") return false;
					currentNode = updatedNode;
					applyAttrs(updatedNode.attrs);
					return true;
				},
			};
		};
	},
});
