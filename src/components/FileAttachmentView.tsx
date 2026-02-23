import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilePdf, faDownload } from "@fortawesome/free-solid-svg-icons";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileAttachmentView({ node, selected }: NodeViewProps) {
  const { src, fileName, fileSize } = node.attrs;

  const handleClick = () => {
    if (src) window.open(src, "_blank");
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!src) return;
    try {
      const savePath = await save({
        defaultPath: fileName || "file.pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!savePath) return;

      const res = await fetch(src);
      const buffer = await res.arrayBuffer();
      await writeFile(savePath, new Uint8Array(buffer));
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
            <span className="file-attachment-size">{formatFileSize(fileSize)}</span>
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
