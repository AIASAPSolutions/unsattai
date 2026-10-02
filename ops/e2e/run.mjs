import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OPS_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ROOT_DIR = resolve(OPS_DIR, '..');
const SERVER_DIR = resolve(ROOT_DIR, 'server');
const API_PORT = process.env.API_PORT || '8200';
const OPS_PORT = process.env.OPS_PORT || '5200';
const DB = process.env.E2E_DB || join(tmpdir(), 'unsattai-ops-e2e.db');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@unsattai.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Adm1nPassword!';
const API_URL = `http://127.0.0.1:${API_PORT}`;
const OPS_URL = `http://127.0.0.1:${OPS_PORT}`;

const processes = [];
function command(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function start(cmd, args, options) {
  const child = spawn(cmd, args, { stdio: 'inherit', ...options });
  processes.push(child);
  return child;
}

function stopAll() {
  for (const child of processes.reverse()) {
    if (!child.killed) child.kill();
  }
}

function onceExit(child, name) {
  return new Promise((resolvePromise, reject) => {
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${name} exited with code ${code}`));
    });
  });
}

async function waitFor(url, name) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Keep polling until the service is ready or the timeout expires.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`${name} did not become ready at ${url}`);
}

function serverPython() {
  const candidates = process.platform === 'win32'
    ? [resolve(SERVER_DIR, '.venv', 'Scripts', 'python.exe'), 'python']
    : [resolve(SERVER_DIR, '.venv', 'bin', 'python'), 'python3', 'python'];
  return candidates.find((candidate) => !candidate.includes('.venv') || existsSync(candidate)) || candidates.at(-1);
}

async function main() {
  rmSync(DB, { force: true });

  start(serverPython(), ['-m', 'uvicorn', 'app.main:app', '--port', API_PORT], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      DB_PATH: DB,
      DESIGN_PROVIDER: 'rule',
      AI_EDITS: 'off',
    },
  });

  await onceExit(spawn(command('npx'), ['vite', 'build', '--logLevel', 'warn'], {
    cwd: OPS_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_API_BASE_URL: API_URL,
      VITE_WEB_STORE_URL: 'http://127.0.0.1:3000',
    },
  }), 'vite build');

  start(command('npx'), ['vite', 'preview', '--host', '127.0.0.1', '--port', OPS_PORT, '--strictPort'], {
    cwd: OPS_DIR,
    env: process.env,
  });

  await waitFor(`${API_URL}/api/v1/health`, 'API');
  await waitFor(`${OPS_URL}/`, 'Ops preview');

  await onceExit(spawn('node', ['e2e/ops-flow.mjs'], {
    cwd: OPS_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      API_URL,
      OPS_URL,
    },
  }), 'ops e2e');
}

process.on('exit', stopAll);
process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(143);
});

main().catch((error) => {
  console.error(error);
  stopAll();
  process.exit(1);
});
