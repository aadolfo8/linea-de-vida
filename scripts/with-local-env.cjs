const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');

function loadLocalEnvironment(file) {
  const values = {};
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const quoted = rawValue.match(/^(["'])(.*)\1$/);
    values[key] = quoted ? quoted[2] : rawValue.replace(/\s+#.*$/, '').trim();
  }
  return values;
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  throw new Error('Usage: node scripts/with-local-env.cjs <command> [arguments...]');
}

const root = resolve(__dirname, '..');
const localEnvironment = loadLocalEnvironment(resolve(root, '.env'));
const child = spawn(command, args, {
  cwd: process.cwd(),
  env: { ...process.env, ...localEnvironment },
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
