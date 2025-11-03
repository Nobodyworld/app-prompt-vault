import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// # agent-entrypoint: Summarises Istanbul coverage for stewardship reporting.

interface IstanbulCoverage {
  [filePath: string]: {
    path: string;
    statementMap: Record<string, any>;
    fnMap: Record<string, any>;
    branchMap: Record<string, any>;
    s: Record<string, number>;
    f: Record<string, number>;
    b: Record<string, number[]>;
  };
}

const coverageDirectory = process.env.COVERAGE_DIR ?? "coverage";
const coverageFiles = readdirSync(coverageDirectory).filter((file) => file.endsWith(".json"));
const projectSrcDir = resolve(process.cwd(), 'src').replace(/\\/g, '/');

if (coverageFiles.length === 0) {
  console.error(`No coverage artifacts found in ${coverageDirectory}. Run tests with coverage enabled.`);
  process.exit(1);
}

type Totals = {
  total: number;
  covered: number;
};

const globalTotals: { functions: Totals; blocks: Totals; statements: Totals } = {
  functions: { total: 0, covered: 0 },
  blocks: { total: 0, covered: 0 },
  statements: { total: 0, covered: 0 },
};

const fileSummaries = new Map<string, { functions: Totals; blocks: Totals; statements: Totals }>();

for (const file of coverageFiles) {
  const payload = JSON.parse(readFileSync(join(coverageDirectory, file), "utf8")) as IstanbulCoverage;

  for (const [filePath, coverage] of Object.entries(payload)) {
    const normalizedFilePath = filePath.replace(/\\/g, '/');
    if (!normalizedFilePath.startsWith(projectSrcDir)) {
      continue;
    }

    const summary = fileSummaries.get(filePath) ?? {
      functions: { total: 0, covered: 0 },
      blocks: { total: 0, covered: 0 },
      statements: { total: 0, covered: 0 },
    };

    // Statements
    for (const [key, count] of Object.entries(coverage.s)) {
      summary.statements.total += 1;
      globalTotals.statements.total += 1;
      if (count > 0) {
        summary.statements.covered += 1;
        globalTotals.statements.covered += 1;
      }
    }

    // Functions
    for (const [key, count] of Object.entries(coverage.f)) {
      summary.functions.total += 1;
      globalTotals.functions.total += 1;
      if (count > 0) {
        summary.functions.covered += 1;
        globalTotals.functions.covered += 1;
      }
    }

    // Branches
    for (const [key, counts] of Object.entries(coverage.b)) {
      for (const count of counts) {
        summary.blocks.total += 1;
        globalTotals.blocks.total += 1;
        if (count > 0) {
          summary.blocks.covered += 1;
          globalTotals.blocks.covered += 1;
        }
      }
    }

    fileSummaries.set(filePath, summary);
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
console.log(`  Statements: ${globalTotals.statements.covered}/${globalTotals.statements.total} (${formatPercent(globalTotals.statements)})`);
console.log(`  Functions: ${globalTotals.functions.covered}/${globalTotals.functions.total} (${formatPercent(globalTotals.functions)})`);
console.log(`  Blocks:    ${globalTotals.blocks.covered}/${globalTotals.blocks.total} (${formatPercent(globalTotals.blocks)})`);

if (globalTotals.functions.total === 0) {
  console.warn(
    "Warning: No project source files were detected in the coverage payload."
  );
}

console.log("\nPer-file:");
for (const [url, summary] of [...fileSummaries.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`- ${url}`);
  console.log(
    `    Statements: ${summary.statements.covered}/${summary.statements.total} (${formatPercent(summary.statements)})`
  );
  console.log(
    `    Functions: ${summary.functions.covered}/${summary.functions.total} (${formatPercent(summary.functions)})`
  );
  console.log(
    `    Blocks:    ${summary.blocks.covered}/${summary.blocks.total} (${formatPercent(summary.blocks)})`
  );
}