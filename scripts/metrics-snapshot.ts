// @ts-nocheck
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { StructuredLogger } from "../src/observability/logger.js";
import { createNoopTelemetry } from "../src/observability/telemetry.js";
import { PromptVaultService } from "../src/services/PromptVaultService.js";

type ComplexitySummary = {
  readonly file: string;
  readonly functions: number;
  readonly average: number;
  readonly max: number;
};

type DependencySummary = {
  readonly nodes: number;
  readonly edges: number;
  readonly maxDepth: number;
};

type PerformanceSample = {
  readonly batchSize: number;
  readonly createBatchMs: number;
  readonly searchMs: number;
  readonly totalPrompts: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const srcRoot = join(projectRoot, "src");

function listSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (stats.isFile() && entry.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function computeFunctionComplexities(sourceFile: ts.SourceFile): number[] {
  const complexities: number[] = [];

  const collect = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      complexities.push(calculateCyclomaticComplexity(node as ts.FunctionLikeDeclarationBase));
      return;
    }
    ts.forEachChild(node, collect);
  };

  collect(sourceFile);
  return complexities;
}

function calculateCyclomaticComplexity(node: ts.FunctionLikeDeclarationBase): number {
  let complexity = 1;

  const walk = (current: ts.Node): void => {
    if (current !== node && ts.isFunctionLike(current)) {
      return;
    }

    switch (current.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CaseClause:
      case ts.SyntaxKind.DefaultClause:
      case ts.SyntaxKind.CatchClause:
        complexity += 1;
        break;
      case ts.SyntaxKind.BinaryExpression: {
        const binary = current as ts.BinaryExpression;
        if (
          binary.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          binary.operatorToken.kind === ts.SyntaxKind.BarBarToken
        ) {
          complexity += 1;
        }
        break;
      }
      case ts.SyntaxKind.ConditionalExpression:
        complexity += 1;
        break;
      default:
        break;
    }

    ts.forEachChild(current, walk);
  };

  walk(node);
  return complexity;
}

function summarizeComplexity(files: readonly string[]): ComplexitySummary[] {
  return files.map((file) => {
    const sourceText = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.ES2022, true);
    const complexities = computeFunctionComplexities(sourceFile);
    const functions = complexities.length;
    const total = complexities.reduce((sum, value) => sum + value, 0);
    const average = functions === 0 ? 0 : Number((total / functions).toFixed(2));
    const max = complexities.reduce((maximum, value) => Math.max(maximum, value), 0);
    return {
      file: relative(projectRoot, file),
      functions,
      average,
      max,
    };
  });
}

type DependencyGraph = Map<string, Set<string>>;

function buildDependencyGraph(files: readonly string[]): DependencyGraph {
  const graph: DependencyGraph = new Map();

  for (const file of files) {
    const relativePath = relative(srcRoot, file).replace(/\\/g, "/");
    graph.set(relativePath, new Set());

    const sourceText = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.ES2022, true);

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (specifier.startsWith(".")) {
          const resolved = resolveImport(file, specifier);
          if (resolved) {
            graph.get(relativePath)?.add(resolved);
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return graph;
}

function resolveImport(fromFile: string, specifier: string): string | null {
  const directory = dirname(fromFile);
  const normalized = specifier
    .replace(/\.js$/u, ".ts")
    .replace(/\.cjs$/u, ".ts")
    .replace(/\.mjs$/u, ".ts");
  const candidates = [
    resolve(directory, normalized),
    resolve(directory, `${normalized}.ts`),
    resolve(directory, `${normalized}.d.ts`),
    resolve(directory, join(normalized, "index.ts")),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return relative(srcRoot, candidate).replace(/\\/g, "/");
    }
  }

  return null;
}

function analyzeDependencies(graph: DependencyGraph): DependencySummary {
  const memo = new Map<string, number>();

  const depth = (node: string, stack: Set<string>): number => {
    if (memo.has(node)) {
      return memo.get(node)!;
    }
    if (stack.has(node)) {
      return 0;
    }
    const neighbours = graph.get(node);
    if (!neighbours || neighbours.size === 0) {
      memo.set(node, 0);
      return 0;
    }
    stack.add(node);
    let max = 0;
    for (const neighbour of neighbours) {
      if (!graph.has(neighbour)) {
        continue;
      }
      const neighbourDepth = 1 + depth(neighbour, stack);
      if (neighbourDepth > max) {
        max = neighbourDepth;
      }
    }
    stack.delete(node);
    memo.set(node, max);
    return max;
  };

  let maxDepth = 0;
  for (const node of graph.keys()) {
    const current = depth(node, new Set());
    if (current > maxDepth) {
      maxDepth = current;
    }
  }

  const edges = Array.from(graph.values()).reduce((sum, neighbours) => sum + neighbours.size, 0);
  return {
    nodes: graph.size,
    edges,
    maxDepth,
  };
}

function logComplexity(summary: readonly ComplexitySummary[]): void {
  console.log("Complexity (cyclomatic):");
  for (const entry of summary) {
    console.log(
      `- ${entry.file}: functions=${entry.functions}, avg=${entry.average}, max=${entry.max}`
    );
  }
  console.log("");
}

function logDependencies(summary: DependencySummary): void {
  const cohesion = summary.nodes === 0 ? 0 : Number((summary.edges / summary.nodes).toFixed(2));
  console.log("Dependency Graph:");
  console.log(`- Nodes: ${summary.nodes}`);
  console.log(`- Edges: ${summary.edges}`);
  console.log(`- Avg fan-out: ${cohesion}`);
  console.log(`- Longest internal path: ${summary.maxDepth}`);
}

/**
 * Measures a representative latency profile by exercising the service layer against an in-memory database. Results help track
 * regressions over time without requiring a dedicated benchmark harness.
 */
function measureServiceLatency(batchSize = 50): PerformanceSample {
  const database = new Database(":memory:");
  try {
    const service = new PromptVaultService(database, {
      telemetry: createNoopTelemetry(),
      logger: new StructuredLogger({ level: "error", fields: { service: "steward-metrics" } }),
    });
    const startCreate = process.hrtime.bigint();
    for (let index = 0; index < batchSize; index += 1) {
      service.createPrompt({
        id: randomUUID(),
        slug: `steward-sample-${index}`,
        title: `Steward Sample ${index}`,
        description: "Synthetic prompt for latency sampling.",
        body: "Sample body",
        semanticVersion: "1.0.0",
        tags: ["steward"],
        changelog: undefined,
      });
    }
    const afterCreate = process.hrtime.bigint();
    const searchStart = process.hrtime.bigint();
    const result = service.searchPrompts({ page: 0, pageSize: batchSize, text: "Steward", tags: undefined });
    const afterSearch = process.hrtime.bigint();
    return {
      batchSize,
      createBatchMs: Number(afterCreate - startCreate) / 1_000_000,
      searchMs: Number(afterSearch - searchStart) / 1_000_000,
      totalPrompts: result.total,
    };
  } finally {
    database.close();
  }
}

function logPerformance(sample: PerformanceSample): void {
  console.log("");
  console.log("Performance Sample:");
  console.log(`- Batch create (${sample.batchSize} prompts): ${sample.createBatchMs.toFixed(2)} ms`);
  console.log(`- Search (pageSize=${sample.batchSize}): ${sample.searchMs.toFixed(2)} ms`);
  console.log(`- Prompts persisted: ${sample.totalPrompts}`);
}

// # agent-entrypoint: Generates repository health metrics for reporting and dashboards.
function main(): void {
  console.log("Prompt Vault Metrics Snapshot\n");
  const files = listSourceFiles(srcRoot);
  const coreFiles = files.filter((file) =>
    ["services", "repositories", "observability"].some((segment) => file.includes(`${segment}/`))
  );
  const complexity = summarizeComplexity(coreFiles);
  logComplexity(complexity);

  const graph = buildDependencyGraph(files);
  const dependencySummary = analyzeDependencies(graph);
  logDependencies(dependencySummary);

  const performance = measureServiceLatency();
  logPerformance(performance);
}

try {
  main();
} catch (error) {
  console.error("Failed to generate metrics snapshot:");
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
}
