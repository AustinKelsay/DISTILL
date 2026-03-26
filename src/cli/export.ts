import { exportSessionsByLabel } from "../distill/export";

function printHelp(): void {
  console.log("Usage: npm run export -- [label]");
  console.log("");
  console.log("Exports labeled sessions to JSONL.");
  console.log("Defaults to the \"train\" label when no label is provided.");
}

function main(): void {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const label = process.argv[2] ?? "train";
  const report = exportSessionsByLabel(label);

  console.log(`Distill export at ${report.exportedAt}`);
  console.log(`Label: ${report.label}`);
  console.log(`Output: ${report.outputPath}`);
  console.log(`Records: ${report.recordCount}`);
}

main();
