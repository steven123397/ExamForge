import { ExamForgeQueryClientProvider } from "../lib/query-client-provider";
import { SessionGate } from "../features/auth/session-gate";

export default function Page() {
  return (
    <ExamForgeQueryClientProvider>
      <SessionGate />
    </ExamForgeQueryClientProvider>
  );
}
