import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const WINDOWS_GRAPH_ARGS = Object.freeze([
  'tree', '--locked', '--manifest-path', 'src-tauri/Cargo.toml',
  '--target', 'x86_64-pc-windows-msvc', '--prefix', 'none', '--color', 'never',
]);

export function assertWindowsGraph(result) {
  if (result.error || result.signal || result.status !== 0) {
    throw new Error('Cargo failed; absence of glib has not been established.');
  }
  if (typeof result.stdout !== 'string' || !result.stdout.trim()) {
    throw new Error('Cargo returned an empty Windows dependency graph.');
  }
  if (/^glib v\S+(?:\s|$)/m.test(result.stdout)) {
    throw new Error('glib unexpectedly appears in the Windows target dependency graph.');
  }
}

export function checkWindowsGraph(run = spawnSync) {
  const result = run('cargo', [...WINDOWS_GRAPH_ARGS], {
    encoding: 'utf8', shell: false, timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assertWindowsGraph(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkWindowsGraph();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Windows dependency graph check failed.');
    process.exitCode = 1;
  }
}
