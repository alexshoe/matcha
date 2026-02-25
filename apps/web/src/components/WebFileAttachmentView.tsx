import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilePdf, faDownload } from "@fortawesome/free-solid-svg-icons";
import { formatBytes } from "@matcha/core";

export function WebFileAttachmentView({ node, selected }: NodeViewProps) {
  const { src, fileName, fileSize } = node.attrs;

  const handleClick = () => {
    if (!src) return;
    try {
      const url = new URL(src);
      if (url.protocol === "https:" || url.protocol === "http:") {
        window.open(src, "_blank");
      }
    } catch {
      // invalid URL — do nothing
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!src) return;
    try {
      const res = await fetch(src);
      const buffer = await res.arrayBuffer();
      const blob = new Blob([buffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "file.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  return (
    <NodeViewWrapper className="file-attachment-wrapper" data-drag-handle>
      <div
        className={`file-attachment-block${selected ? " selected" : ""}`}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") handleClick(); }}
      >
        <div className="file-attachment-icon">
          <FontAwesomeIcon icon={faFilePdf} />
        </div>
        <div className="file-attachment-info">
          <span className="file-attachment-name">{fileName}</span>
          {fileSize && (
            <span className="file-attachment-size">{fileSize ? formatBytes(fileSize) : ""}</span>
          )}
        </div>
        <button
          className="file-attachment-download"
          onClick={handleDownload}
          title="Download"
        >
          <FontAwesomeIcon icon={faDownload} />
        </button>
      </div>
    </NodeViewWrapper>
  );
}
