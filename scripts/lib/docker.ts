import { spawn, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The Compose file for the local database.
 *
 * `-f` is always passed with the absolute path because these helpers are called
 * from `npm` scripts, whose working directory is the repository root while
 * Compose resolves relative paths against the directory holding the file.
 */
export const composeFile = resolve(projectRoot, 'local-dev', 'docker-compose.yml');

export const serviceName = 'db';
export const containerName = 'glow-grace-local-db';

export type ComposeResult = { status: number; stdout: string; stderr: string };

function dockerAvailable(): boolean {
  const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  return probe.status === 0;
}

export function requireDocker() {
  if (dockerAvailable()) return;
  throw new Error(
    'Docker is not reachable. Start Docker Desktop and run this again.\n'
    + 'The local database is a container; there is no fallback that would still be PostgreSQL.',
  );
}

export function compose(args: string[], options: { capture?: boolean } = {}): ComposeResult {
  const result = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    // Compose interpolates ${POSTGRES_*}, and it can only see them from the
    // environment it is launched with. These are in process.env because the env
    // loader already read .env.local.
    env: process.env,
    ...(options.capture
      ? {}
      : { stdio: ['ignore', 'inherit', 'inherit'] }),
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function composeOrThrow(args: string[]) {
  const result = compose(args);
  if (result.status !== 0) {
    throw new Error(`\`docker compose ${args.join(' ')}\` failed with exit code ${result.status}.`);
  }
  return result;
}

/** Container state, without starting anything. */
export function containerStatus(): 'running' | 'exited' | 'missing' {
  const result = spawnSync(
    'docker',
    ['inspect', '--format', '{{.State.Status}}', containerName],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) return 'missing';
  const state = (result.stdout ?? '').trim();
  return state === 'running' ? 'running' : 'exited';
}

/**
 * Blocks until the database answers a real connection.
 *
 * Not a fixed sleep and not "the container is running": the image takes several
 * seconds past `docker compose up -d` to initialise a fresh volume, and starting
 * the API against a socket that is not listening yet produces a first request
 * failure that looks like a bug. `pg_isready` is the same check Docker's own
 * healthcheck runs, so this returns at the moment the container considers itself
 * healthy and not before.
 */
export async function waitForDatabase(timeoutMs = 90_000): Promise<void> {
  const user = process.env.POSTGRES_USER ?? 'glow_grace';
  const database = process.env.POSTGRES_DB ?? 'glow_grace';
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    const probe = spawnSync(
      'docker',
      ['exec', containerName, 'pg_isready', '-U', user, '-d', database],
      { encoding: 'utf8' },
    );
    if (probe.status === 0) return;
    lastError = (probe.stderr ?? probe.stdout ?? '').trim();
    await new Promise((resolveDelay) => { setTimeout(resolveDelay, 1_000); });
  }

  throw new Error(
    `The local database did not become ready within ${Math.round(timeoutMs / 1000)}s. `
    + `Last reported: ${lastError || 'no response'}.\nRun \`npm run db:logs\` to see why.`,
  );
}

/** Runs a command as a child, inheriting stdio so Ctrl-C reaches it. */
export function run(command: string, args: string[], label: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    console.log(`\n> ${label}\n  ${command} ${args.join(' ')}\n`);
    const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${label} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}

export function sleep(ms: number) {
  return new Promise((resolveDelay) => { setTimeout(resolveDelay, ms); });
}