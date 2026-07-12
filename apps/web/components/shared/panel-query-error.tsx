import { RefreshCw } from "lucide-react";

export function PanelQueryError({
  message,
  retrying,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  onRetry(): Promise<unknown>;
}) {
  return (
    <div className="panel-query-error" role="alert" aria-live="polite">
      <span>{message}</span>
      <button
        type="button"
        className="mini-button"
        disabled={retrying}
        onClick={() => void onRetry()}
      >
        <RefreshCw size={15} />
        {retrying ? "重试中…" : "重试"}
      </button>
    </div>
  );
}
