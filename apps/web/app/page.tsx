import { OperationsConsole } from "./operations-console";
import { ExamForgeQueryClientProvider } from "../lib/query-client-provider";

export default function Page() {
  return (
    <ExamForgeQueryClientProvider>
      <OperationsConsole />
    </ExamForgeQueryClientProvider>
  );
}
