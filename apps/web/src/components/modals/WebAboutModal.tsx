import React from "react";

interface Props {
  onClose: () => void;
}

export function WebAboutModal({ onClose }: Props) {
  return (
    <div className="share-overlay" onMouseDown={onClose}>
      <div
        className="modal-card"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ maxWidth: 380 }}
      >
        <div className="modal-header">
          <h2 className="modal-title">About Matcha</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: "1.5rem", textAlign: "center" }}>
          <p style={{ marginBottom: "0.5rem", fontWeight: 600, fontSize: "1.1rem" }}>
            Matcha
          </p>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            Version 0.1.0
          </p>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
            A beautiful, focused note-taking app.
          </p>
        </div>
      </div>
    </div>
  );
}
