/**
 * One-command demo: seed, run both worker jobs, then start the API.
 *
 *   npm run demo            (builds the web app first, then runs this)
 *   node scripts/demo.mjs   (what render.yaml's startCommand runs)
 *
 * With the web app built, the API also serves it (server.ts, "web app"), so the whole
 * product is on one URL: http://localhost:4000 locally, or the Render service URL.
 *
 * Seed data is anchored to today's date, so payroll runs for the previous calendar month
 * (Asia/Dhaka) -- the latest month that is complete -- and the at-risk list is scored
 * before the first request arrives, so no screen starts empty.
 */

import { spawnSync, spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function step(args) {
  const r = spawnSync(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`[demo] "npm ${args.join(' ')}" failed with exit code ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

const [year, month] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' })
  .format(new Date())
  .split('-')
  .map(Number);
const prevYear = month === 1 ? year - 1 : year;
const prevMonth = month === 1 ? 12 : month - 1;

step(['run', 'seed']);
step(['run', 'job:score']);
step(['run', 'job:payroll', '--', String(prevYear), String(prevMonth)]);

const api = spawn(npm, ['run', 'start', '-w', '@pulsehr/api'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => api.kill(signal));
api.on('exit', (code) => process.exit(code ?? 0));
