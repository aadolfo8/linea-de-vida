/** A failed load with the way to try again. */
export function RetryAlert({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="sp-alert">
      {message}{' '}
      <button type="button" className="sp-btn" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}
