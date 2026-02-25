import React, { useCallback, useEffect, useRef, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

const MIN_WIDTH = 80;

export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [resizing, setResizing] = useState(false);

  const { src, alt, title, width } = node.attrs;

  const onResizeStart = useCallback(
    (e: React.MouseEvent, handle: "left" | "right") => {
      e.preventDefault();
      e.stopPropagation();
      setResizing(true);

      const startX = e.clientX;
      const startWidth = imgRef.current?.offsetWidth ?? 300;

      const onMove = (ev: MouseEvent) => {
        const delta = handle === "right"
          ? ev.clientX - startX
          : startX - ev.clientX;
        const next = Math.max(MIN_WIDTH, startWidth + delta);
        updateAttributes({ width: next });
      };

      const onUp = () => {
        setResizing(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [updateAttributes],
  );

  useEffect(() => {
    if (resizing) {
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    } else {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [resizing]);

  return (
    <NodeViewWrapper className="resizable-image-wrapper" data-drag-handle>
      <div
        ref={containerRef}
        className={`resizable-image-container${selected ? " selected" : ""}`}
        style={{ width: width ? `${width}px` : undefined }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt || ""}
          title={title || undefined}
          draggable={false}
        />
        {selected && (
          <>
            <div
              className="resize-handle resize-handle-left"
              onMouseDown={(e) => onResizeStart(e, "left")}
            />
            <div
              className="resize-handle resize-handle-right"
              onMouseDown={(e) => onResizeStart(e, "right")}
            />
          </>
        )}
      </div>
    </NodeViewWrapper>
  );
}
