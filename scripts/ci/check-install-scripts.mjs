let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}

let report;
try {
  report = JSON.parse(input);
} catch {
  console.error("Unable to parse the npm install-script report.");
  process.exit(1);
}

if (!Array.isArray(report.allowScripts)) {
  console.error("The npm install-script report is missing allowScripts.");
  process.exit(1);
}

const pending = report.allowScripts
  .flatMap((entry) => entry.changes ?? [])
  .filter((change) => change.change === "pending")
  .map((change) => change.key)
  .sort();

if (pending.length > 0) {
  console.error("Unreviewed dependency install scripts:");
  for (const packageKey of pending) {
    console.error(`  - ${packageKey}`);
  }
  process.exit(1);
}

console.log("Install-script approvals are complete.");
