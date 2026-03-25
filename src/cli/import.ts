import { runImport } from "../distill/import";

function main(): void {
  const report = runImport();

  console.log(`Distill import at ${report.importedAt}`);
  console.log(`Database: ${report.databasePath}`);
  console.log(`Home: ${report.distillHome}\n`);

  for (const summary of report.sourceSummaries) {
    console.log(`${summary.kind}`);
    console.log(`  discovered: ${summary.discoveredCaptures}`);
    console.log(`  imported: ${summary.importedCaptures}`);
    console.log(`  skipped: ${summary.skippedCaptures}\n`);
  }
}

main();
