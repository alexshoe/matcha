import Image from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ResizableImageView } from "../components/ResizableImageView";

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = (el as HTMLElement).getAttribute("width")
            || (el as HTMLElement).style.width;
          return w ? parseInt(w, 10) || null : null;
        },
        renderHTML: (attrs) => {
          if (!attrs.width) return {};
          return { width: attrs.width };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
