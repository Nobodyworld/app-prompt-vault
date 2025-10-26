import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// # agent-entrypoint: Summarises raw V8 coverage for stewardship reporting.

interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

interface FunctionCoverage {
  functionName: string;
  ranges: CoverageRange[];
  isBlockCoverage: boolean;
}

interface ScriptCoverage {
  url: string;
  functions: FunctionCoverage[];
}

interface CoverageFile {
  result: ScriptCoverage[];
}

const coverageDirectory = process.env.COVERAGE_DIR ?? "coverage";
const coverageFiles = readdirSync(coverageDirectory).filter((file) => file.endsWith(".json"));
const projectSrcPrefix = `file://${process.cwd()}/src/`;

if (coverageFiles.length === 0) {
  console.error(`No coverage artifacts found in ${coverageDirectory}. Run tests with NODE_V8_COVERAGE=${coverageDirectory}.`);
  process.exit(1);
}

type Totals = {
  total: number;
  covered: number;
};

const globalTotals: { functions: Totals; blocks: Totals } = {
  functions: { total: 0, covered: 0 },
  blocks: { total: 0, covered: 0 },
};

const fileSummaries = new Map<string, { functions: Totals; blocks: Totals }>();

for (const file of coverageFiles) {
  const payload = JSON.parse(
    readFileSync(join(coverageDirectory, file), "utf8")
  ) as CoverageFile;

  for (const script of payload.result) {
    if (!script.url.startsWith(projectSrcPrefix)) {
      continue;
    }

    const summary = fileSummaries.get(script.url) ?? {
      functions: { total: 0, covered: 0 },
      blocks: { total: 0, covered: 0 },
    };

    for (const fn of script.functions) {
      summary.functions.total += 1;
      globalTotals.functions.total += 1;

      const functionCovered = fn.ranges.some((range) => range.count > 0);
      if (functionCovered) {
        summary.functions.covered += 1;
        globalTotals.functions.covered += 1;
      }

      if (fn.isBlockCoverage) {
        for (const range of fn.ranges) {
          summary.blocks.total += 1;
          globalTotals.blocks.total += 1;
          if (range.count > 0) {
            summary.blocks.covered += 1;
            globalTotals.blocks.covered += 1;
          }
        }
      }
    }

    fileSummaries.set(script.url, summary);
  }
}

const formatPercent = (totals: Totals): string => {
  if (totals.total === 0) {
    return "N/A";
  }
  return ((totals.covered / totals.total) * 100).toFixed(2) + "%";
};

console.log("Prompt Vault Coverage Summary\n");
console.log("Global:");
console.log(`  Functions: ${globalTotals.functions.covered}/${globalTotals.functions.total} (${formatPercent(globalTotals.functions)})`);
console.log(`  Blocks:    ${globalTotals.blocks.covered}/${globalTotals.blocks.total} (${formatPercent(globalTotals.blocks)})`);

if (globalTotals.functions.total === 0) {
  console.warn(
    "Warning: No project source files were detected in the coverage payload. Install @vitest/coverage-v8 or configure V8 instrumentation to include transformed modules."
  );
}

console.log("\nPer-file:");
for (const [url, summary] of [...fileSummaries.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`- ${url}`);
  console.log(
    `    Functions: ${summary.functions.covered}/${summary.functions.total} (${formatPercent(summary.functions)})`
  );
  console.log(
    `    Blocks:    ${summary.blocks.covered}/${summary.blocks.total} (${formatPercent(summary.blocks)})`
  );
}
