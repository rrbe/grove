export function Alert({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss?: () => void;
}) {
  if (!message) return null;

  return (
    <div className="alert-banner">
      <span>{message}</span>
      {onDismiss && (
        <button className="alert-dismiss" onClick={onDismiss}>
          &times;
        </button>
      )}
    </div>
  );
}
