// CI-only process orchestration; this is never shipped to Cloudflare runtime.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
writeFileSync('.dev.vars', 'OPERATOR_PASSWORD=' + randomBytes(32).toString('hex') + '\n');
chmodSync('.dev.vars', 0o600);
const run = command => { const result = spawnSync(command, { shell: true, stdio: 'inherit' }); if (result.status !== 0) throw new Error('Check failed: ' + command); };
run('npm run db:local');
const server = spawn('npx', ['wrangler', 'pages', 'dev', 'dist', '--ip', '127.0.0.1', '--port', '3000'], { detached: true, stdio: 'ignore' });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://localhost:3000')).status === 401) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Local Worker failed to start');
  run('npm test'); run('npm run test:ui');
} finally { try { process.kill(-server.pid, 'SIGTERM'); } catch {} }
