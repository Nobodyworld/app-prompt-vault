import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertWindowsGraph, checkWindowsGraph, WINDOWS_GRAPH_ARGS } from './check-windows-glib.mjs';

const ok = (stdout = 'prompt-vault v0.4.0\ntauri v2.0.0\n') => ({
  status: 0, signal: null, error: undefined, stdout, stderr: '',
});

test('accepts a successful Windows graph without glib', () => {
  assert.doesNotThrow(() => assertWindowsGraph(ok()));
});
for (const [name, result] of [
  ['nonzero exit with no glib text', { ...ok(), status: 101 }],
  ['nonzero exit with partial output', { ...ok('tauri v2.0.0\n'), status: 1 }],
  ['failed spawn', { ...ok(), status: null, error: new Error('ENOENT') }],
  ['terminated command', { ...ok(), status: null, signal: 'SIGTERM' }],
  ['empty graph', ok('')],
  ['whitespace-only graph', ok(' \n')],
  ['glib at the root', ok('glib v0.18.5\n')],
  ['glib deeper in an unprefixed graph', ok('prompt-vault v0.4.0\nglib v0.18.5 (*)\n')],
]) {
  test(`rejects ${name}`, () => assert.throws(() => assertWindowsGraph(result)));
}
test('does not confuse glib-sys or similar package names with glib', () => {
  assert.doesNotThrow(() => assertWindowsGraph(ok('glib-sys v0.18.1\nsomething-glib v1.0.0\n')));
});
test('queries the locked complete Windows graph and propagates failure', () => {
  assert.throws(() => checkWindowsGraph((command, args, options) => {
    assert.equal(command, 'cargo');
    assert.deepEqual(args, [...WINDOWS_GRAPH_ARGS]);
    assert.ok(args.includes('--locked'));
    assert.equal(args[args.indexOf('--target') + 1], 'x86_64-pc-windows-msvc');
    assert.equal(args[args.indexOf('--prefix') + 1], 'none');
    assert.ok(!args.includes('--invert'));
    assert.equal(options.shell, false);
    assert.ok(options.timeout > 0);
    return { ...ok(''), status: 101 };
  }), /Cargo failed/);
});
