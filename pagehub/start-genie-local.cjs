#!/usr/bin/env node
'use strict';
// Local-only supervisor. No Docker, deployment, provider, or secret access.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const ROOT = __dirname;
const PORT = 18900;
const PIPE = '\\\\.\\pipe\\pagehub-packet-studio-18900';
const LOG = path.join(ROOT, 'genie-local.log');
const LIMIT = 16 * 1024 * 1024;
const KEEP = 4;
function appendLog(chunk) {
  if (fs.existsSync(LOG) && fs.statSync(LOG).size + Buffer.byteLength(chunk) > LIMIT) {
    for (let n = KEEP; n >= 1; n--) {
      const target = LOG + '.' + n;
      const source = n === 1 ? LOG : LOG + '.' + (n - 1);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      if (fs.existsSync(source)) fs.renameSync(source, target);
    }
  }
  fs.appendFileSync(LOG, chunk);
}
function note(message) { appendLog('[supervisor] ' + new Date().toISOString() + ' ' + message + '\n'); }
function portOpen() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port: PORT });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(1000); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
  });
}
function control(command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(PIPE); let text = '';
    socket.setTimeout(5000);
    socket.once('connect', () => socket.write(command + '\n'));
    socket.on('data', chunk => { text += chunk; if (text.length > 4096) socket.destroy(new Error('Invalid supervisor response')); });
    socket.once('end', () => resolve(text.trim()));
    socket.once('error', reject);
    socket.once('timeout', () => socket.destroy(new Error('Supervisor unavailable')));
  });
}
async function supervise() {
  let child = null; let timer = null; let stopping = false;
  const manager = net.createServer(socket => {
    socket.setTimeout(2000, () => socket.destroy());
    socket.once('data', data => {
      const command = data.toString('utf8').trim();
      if (!['status', 'restart'].includes(command)) return socket.end('Invalid command\n');
      socket.end(JSON.stringify({ ok: true, supervisorPid: process.pid, childPid: child?.pid || null, port: PORT, command }) + '\n');
      if (command === 'restart') {
        note('Owner requested restart');
        if (child) child.kill(); else { clearTimeout(timer); launch(); }
      }
    });
  });
  manager.on('error', error => { if (error.code === 'EADDRINUSE') process.exit(0); console.error(error.message); process.exit(1); });
  await new Promise(resolve => manager.listen(PIPE, resolve));
  if (await portOpen()) { note('Port 18900 already occupied; existing process preserved'); manager.close(); return; }
  function launch() {
    if (stopping) return;
    child = spawn(process.execPath, [path.join(ROOT, 'serve-genie.cjs')], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GENIE_PORT: String(PORT) } });
    note('Started server pid=' + child.pid);
    child.stdout.on('data', appendLog); child.stderr.on('data', appendLog);
    child.once('error', error => note('Spawn error: ' + error.message));
    child.once('close', (code, signal) => {
      note('Server closed code=' + code + ' signal=' + signal); child = null;
      if (!stopping) timer = setTimeout(launch, 3000);
    });
  }
  function stop() {
    stopping = true; clearTimeout(timer); if (child) child.kill();
    manager.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref();
  }
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  note('Supervisor started pid=' + process.pid); launch();
}
const mode = process.argv[2] || '--run';
if (mode === '--detach') {
  const child = spawn(process.execPath, [__filename, '--run'], { cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref(); console.log('Supervisor launch requested; verify with --status.');
} else if (mode === '--restart' || mode === '--status') {
  control(mode.slice(2)).then(console.log).catch(error => { console.error(error.message); process.exitCode = 1; });
} else if (mode === '--run') supervise().catch(error => { console.error(error.message); process.exitCode = 1; });
else { console.error('Use --detach, --run, --status, or --restart'); process.exitCode = 1; }
