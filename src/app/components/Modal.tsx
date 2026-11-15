import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const invokingControl = useRef<HTMLElement | null>(null);
  const focusCaptured = useRef(false);
  const titleId = useId();
  const subtitleId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!focusCaptured.current) {
      invokingControl.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      focusCaptured.current = true;
    }
    node?.showModal();
    return () => {
      node?.close();
      queueMicrotask(() => {
        if (!node?.open && invokingControl.current?.isConnected)
          invokingControl.current.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      className={`modal ${wide ? 'modal-wide' : ''}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        const bounds = dialog.current?.getBoundingClientRect();
        if (
          event.target === dialog.current &&
          bounds &&
          (event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom)
        )
          onClose();
      }}
    >
      <div className="modal-header">
        <div>
          <span className="eyebrow">COUNTERLAB / WORKSPACE</span>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p id={subtitleId}>{subtitle}</p>}
        </div>
        <button type="button" className="icon-button" aria-label="关闭对话框" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
