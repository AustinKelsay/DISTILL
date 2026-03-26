import { exportSessionsByLabel } from "../distill/export";

function main(): void {
  const label = process.argv[2] ?? "train";
  const report = exportSessionsByLabel(label);

  console.log(`Distill export at ${report.exportedAt}`);
  console.log(`Label: ${report.label}`);
  console.log(`Output: ${report.outputPath}`);
  console.log(`Records: ${report.recordCount}`);
}

main();
