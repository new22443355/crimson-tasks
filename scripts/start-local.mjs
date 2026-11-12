import { cp, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const standalone = path.join(root, '.next/standalone');
await mkdir(path.join(standalone, '.next'), { recursive: true });
await cp(path.join(root, '.next/static'), path.join(standalone, '.next/static'), { recursive: true });
await cp(path.join(root, 'public'), path.join(standalone, 'public'), { recursive: true });
const server = spawn(process.execPath, [path.join(standalone, 'server.js')], {
  cwd: root, stdio: 'inherit', env: { ...process.env, HOSTNAME: '127.0.0.1' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.on('exit', code => { process.exitCode = code ?? 0; });
