'use strict';
const cp = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function run(cmd, args) {
  const result = cp.spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status || 1);
}
run(process.execPath, ['build/build-fixture.cjs', 'fixtures/burns-record.json']);
run(process.execPath, [
  '--test',
  'tests/core.test.cjs',
  'tests/trust.test.cjs',
  'tests/categories.test.cjs',
  'tests/integration.test.cjs',
  'tests/rich-contract.test.cjs',
  'tests/intake-concurrent-runner.test.cjs',
]);
run('python', ['tests/visual-parity.py']);
