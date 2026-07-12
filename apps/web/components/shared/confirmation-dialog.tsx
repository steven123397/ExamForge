import { TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function ConfirmationDialog({
  title,
  target,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  target: string;
  description: string;
  confirmLabel: string;
  onConfirm(): Promise<void>;
  onCancel(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    cancelButtonRef.current?.focus();
    return () => {
      if (dialog?.open) {
        dialog.close();
      }
      previousFocus?.focus();
    };
  }, []);

  async function confirm() {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm();
      onCancel();
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirmation-dialog"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) {
          onCancel();
        }
      }}
    >
      <div className="confirmation-dialog-heading">
        <TriangleAlert size={22} aria-hidden="true" />
        <h2 id={titleId}>{title}</h2>
      </div>
      <p className="confirmation-target">
        <span>目标</span>
        <strong>{target}</strong>
      </p>
      <p id={descriptionId}>{description}</p>
      <div className="confirmation-dialog-actions">
        <button
          ref={cancelButtonRef}
          type="button"
          className="secondary-button"
          disabled={submitting}
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="danger-button"
          data-testid="confirmation-confirm"
          disabled={submitting}
          onClick={() => void confirm()}
        >
          {submitting ? "处理中…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
