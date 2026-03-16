import { useEffect } from "react";

export function ModalShell({
  title,
  onClose,
  canClose = true,
  className,
  children,
  ...rest
}: {
  title: string;
  onClose: () => void;
  canClose?: boolean;
  className?: string;
  children: React.ReactNode;
  [key: `data-${string}`]: string;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && canClose) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, canClose]);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && canClose && onClose()}
    >
      <div
        className={`modal-card ${className ?? ""}`}
        onClick={(e) => e.stopPropagation()}
        {...rest}
      >
        <div className="modal-shell-header">
          <span className="section-heading" style={{ flex: 1 }}>{title}</span>
          {canClose && (
            <button
              className="modal-shell-close"
              onClick={onClose}
              aria-label="Close"
            >
              &times;
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
