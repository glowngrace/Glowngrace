import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type VercelRewrite = { source: string; destination: string };

export type VercelConfig = {
  framework?: string;
  buildCommand?: string;
  installCommand?: string;
  outputDirectory?: string;
  cleanUrls?: boolean;
  rewrites?: VercelRewrite[];
  functions?: Record<string, { maxDuration?: number }>;
};

export type RouteResolution = {
  kind: 'static' | 'function' | 'rewrite' | 'not-found';
  target: string;
};

export type DeploymentRouter = {
  config: VercelConfig;
  staticRoot: string;
  resolveRequest(pathname: string): RouteResolution;
  staticFilePath(pathname: string): string | null;
};

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadVercelConfig(root: string = projectRoot): VercelConfig {
  return JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as VercelConfig;
}

type CompiledSource = { pattern: RegExp; parameters: string[] };

function readGroup(source: string, start: number) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
    } else if (source[index] === '(') {
      depth += 1;
    } else if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return { text: source.slice(start, index + 1), end: index + 1 };
    }
  }
  throw new Error(`Unbalanced group in path pattern: ${source}`);
}

export function compileSource(source: string): CompiledSource {
  const parameters: string[] = [];
  let pattern = '';
  let index = 0;
  while (index < source.length) {
    const parameter = /^:([A-Za-z0-9_]+)(\*|\?)?/.exec(source.slice(index));
    if (parameter) {
      const [token, name, modifier] = parameter;
      const rest = source.slice(index + token.length);
      if (rest.startsWith('(')) {
        const group = readGroup(rest, 0);
        pattern += group.text;
        index += token.length + group.end;
      } else {
        pattern += modifier === '*' ? '(.*)' : modifier === '?' ? '([^/]*)' : '([^/]+)';
        index += token.length;
      }
      parameters.push(name);
      continue;
    }
    if (source[index] === '(') {
      const group = readGroup(source, index);
      pattern += group.text;
      parameters.push('');
      index = group.end;
      continue;
    }
    pattern += source[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    index += 1;
  }
  return { pattern: new RegExp(`^${pattern}$`), parameters };
}

export function matchRewrite(rewrite: VercelRewrite, pathname: string): Record<string, string> | null {
  const compiled = compileSource(rewrite.source);
  const match = compiled.pattern.exec(pathname);
  if (!match) return null;
  const values: Record<string, string> = {};
  compiled.parameters.forEach((name, position) => {
    if (name) values[name] = match[position + 1] ?? '';
  });
  return values;
}

export function applyDestination(destination: string, values: Record<string, string>) {
  return destination.replace(/:([A-Za-z0-9_]+)\*?/g, (token, name: string) => values[name] ?? token);
}

export function normalizePathname(pathname: string) {
  const withoutQuery = pathname.split('?')[0].split('#')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return null;
  }
  const normalized = posix.normalize(decoded);
  if (!normalized.startsWith('/') || normalized.includes('\0')) return null;
  return normalized;
}

function isFile(path: string) {
  return existsSync(path) && statSync(path).isFile();
}

function isDirectory(path: string) {
  return existsSync(path) && statSync(path).isDirectory();
}

function readEntries(path: string) {
  if (!isDirectory(path)) return [];
  return readdirSync(path);
}

function dynamicEntry(entries: string[]) {
  return entries.find((entry) => /^\[[A-Za-z0-9_]+\](\.[A-Za-z0-9]+)?$/.test(entry));
}

function containedFile(root: string, pathname: string) {
  const normalized = normalizePathname(pathname);
  if (!normalized) return null;
  const relative = normalized.replace(/^\/+/, '');
  if (!relative) return null;
  const absolute = resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(root + sep)) return null;
  return isFile(absolute) ? absolute : null;
}

export function createDeploymentRouter(options: { root?: string; staticRoot?: string } = {}): DeploymentRouter {
  const root = options.root ?? projectRoot;
  const config = loadVercelConfig(root);
  const staticRoot = options.staticRoot ?? join(root, config.outputDirectory ?? 'dist');

  function staticFilePath(pathname: string) {
    return containedFile(staticRoot, pathname);
  }

  function functionFilePath(pathname: string) {
    const normalized = normalizePathname(pathname);
    if (!normalized) return null;
    const segments = normalized.replace(/^\/+/, '').split('/');
    if (segments[0] !== 'api' || !isDirectory(join(root, 'api'))) return null;
    const directories = ['api'];
    for (const segment of segments.slice(1, -1)) {
      const entries = readEntries(join(root, ...directories));
      const match = entries.includes(segment) ? segment : dynamicEntry(entries);
      if (!match || !isDirectory(join(root, ...directories, match))) return null;
      directories.push(match);
    }
    const name = segments[segments.length - 1];
    const prefix = `/${directories.join('/')}`;
    const entries = readEntries(join(root, ...directories));
    const file = entries.includes(`${name}.ts`) ? `${name}.ts` : dynamicEntry(entries);
    if (!file) return null;
    return containedFile(root, `${prefix}/${file.endsWith('.ts') ? file : `${file}.ts`}`);
  }

  function resolveRequest(rawPathname: string): RouteResolution {
    const pathname = normalizePathname(rawPathname);
    if (!pathname) return { kind: 'not-found', target: rawPathname };
    const staticFile = staticFilePath(pathname);
    if (staticFile) return { kind: 'static', target: staticFile };
    const functionFile = functionFilePath(pathname);
    if (functionFile) return { kind: 'function', target: functionFile };
    for (const rewrite of config.rewrites ?? []) {
      const values = matchRewrite(rewrite, pathname);
      if (values) return { kind: 'rewrite', target: applyDestination(rewrite.destination, values) };
    }
    return { kind: 'not-found', target: pathname };
  }

  return { config, staticRoot, resolveRequest, staticFilePath };
}
