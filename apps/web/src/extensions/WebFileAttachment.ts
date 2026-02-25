import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { WebFileAttachmentView } from "../components/WebFileAttachmentView";

export interface WebFileAttachmentOptions {
  inline: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fileAttachment: {
      setFileAttachment: (attrs: {
        src: string;
        fileName: string;
        fileSize?: number;
      }) => ReturnType;
    };
  }
}

export const WebFileAttachment = Node.create<WebFileAttachmentOptions>({
  name: "fileAttachment",

  group: "block",

  atom: true,

  draggable: true,

  addOptions() {
    return { inline: false };
  },

  addAttributes() {
    return {
      src: { default: null },
      fileName: { default: "Untitled.pdf" },
      fileSize: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-file-attachment]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-file-attachment": "" }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WebFileAttachmentView);
  },

  addCommands() {
    return {
      setFileAttachment:
        (attrs) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          });
        },
    };
  },
});
