import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync,
  realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const WORKSPACE = String.raw`D:\Websites\avsworklog`;
// The check runner deliberately redirects HOME/USERPROFILE. Resolve the enrolled
// Windows account profile from the OS token, never those caller environment values.
export const CACHE_ROOT = path.join(userInfo().homedir, '.codex', 'cursor-worker', 'squires-typecheck-cache');
const sha = value => createHash('sha256').update(value).digest('hex');
const encoded = value => JSON.stringify(value);
const fail = reason => { throw new Error(`Typecheck cache: ${reason}`); };

function ordinary(target, directory = false) {
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) ||
      realpathSync(target) !== path.resolve(target) || (!directory && stat.nlink !== 1)) {
    fail('non-ordinary path');
  }
}

function ordinaryAncestors(target) {
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    ordinary(current, true);
    if (path.dirname(current) === current) break;
  }
}

function ownerOnly(root) {
  if (process.platform !== 'win32') {
    if ((lstatSync(root).mode & 0o077) !== 0 || lstatSync(root).uid !== process.getuid()) {
      fail('owner-only directory required');
    }
    return;
  }
  const script = [
    '$ErrorActionPreference="Stop"',
    '$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$items=@(Get-Item -LiteralPath $args[0]) + @(Get-ChildItem -LiteralPath $args[0] -Force)',
    'foreach($item in $items){',
    '$acl=Get-Acl -LiteralPath $item.FullName',
    'if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid){throw "owner"}',
    'foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){',
    'if($rule.AccessControlType -eq "Allow" -and $rule.IdentityReference.Value -ne $sid){throw "ACL"}',
    '}}',
  ].join(';').replaceAll('{;', '{').replaceAll(';}', '}');
  const result = spawnSync(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
    ['-NoProfile', '-NonInteractive', '-Command', `& { ${script} }`, root],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH')) });
  if (result.error || result.status !== 0) fail('owner-only Windows ACL required');
}

function durableFile(target, bytes) {
  const fd = openSync(target, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// The exported constructor permits isolated fixtures; the CLI never accepts paths.
export function createTypecheckCache(workspace, root) {
  workspace = path.resolve(workspace);
  root = path.resolve(root);
  ordinaryAncestors(workspace);
  const relativeRoot = path.relative(workspace, root);
  if (!relativeRoot || (!path.isAbsolute(relativeRoot) && !relativeRoot.startsWith('..' + path.sep))) {
    fail('cache must be outside checkout');
  }
  const cache = path.join(root, 'cache.tsbuildinfo');
  const manifest = path.join(root, 'manifest.json');
  const pending = path.join(root, 'next.tsbuildinfo');
  const pendingManifest = path.join(root, 'manifest.pending');
  const lock = path.join(root, 'cache.lock');
  const compiler = path.join(workspace, 'node_modules', 'typescript', 'bin', 'tsc');
  const dependencyRoot = realpathSync(path.join(workspace, 'node_modules'));
  const ts = createRequire(path.join(workspace, 'package.json'))('typescript');
  const within = (parent, target) => {
    const relative = path.relative(parent, target);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' &&
      !relative.startsWith('..' + path.sep));
  };

  function locked(operation) {
    ordinaryAncestors(root);
    ownerOnly(root);
    const fd = openSync(lock, 'wx', 0o600);
    try {
      writeFileSync(fd, String(process.pid));
      fsyncSync(fd);
      if (existsSync(pending) || existsSync(pendingManifest)) fail('interrupted write; owner reconciliation required');
      return operation();
    } finally {
      closeSync(fd);
      unlinkSync(lock);
    }
  }

  function inputPath(name) {
    const target = path.resolve(workspace, name);
    const relative = path.relative(workspace, target);
    if ((relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) &&
        !within(dependencyRoot, target)) fail('input path escaped checkout');
    return target;
  }

  function digestFiles(names) {
    return sha(encoded([...new Set(names)].sort().map(name => {
      const target = inputPath(name);
      if (!existsSync(target)) return [name, null];
      // Installed dependencies may be an explicitly trusted fixture junction, never cache artifacts.
      if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()) fail('non-file compiler input');
      const canonical = realpathSync(target);
      if (!within(workspace, canonical) && !within(dependencyRoot, canonical)) fail('input link escaped checkout');
      return [name, sha(readFileSync(target))];
    })));
  }

  function configuration() {
    const configs = [];
    const host = { ...ts.sys, readFile(name) {
      ordinary(name);
      const bytes = ts.sys.readFile(name);
      configs.push([path.relative(workspace, name), bytes]);
      return bytes;
    } };
    const parsed = ts.getParsedCommandLineOfConfigFile(path.join(workspace, 'tsconfig.json'), {}, {
      ...host, onUnRecoverableConfigFileDiagnostic() { fail('invalid project configuration'); },
    });
    if (!parsed || parsed.errors.length || parsed.projectReferences?.length ||
        configs.some(([name]) => name.startsWith('..' + path.sep) || path.isAbsolute(name))) {
      fail('unsupported or invalid project configuration');
    }
    return { configs, sources: parsed.fileNames.map(name => path.relative(workspace, name)) };
  }

  function identity(inputs) {
    const config = configuration();
    const dependencies = inputs.filter(name => name.split(path.sep).includes('node_modules'));
    const dependencyNames = new Set(dependencies);
    const packages = ['package.json', 'package-lock.json', 'node_modules/.package-lock.json'];
    const visitedDirectories = new Set();
    for (const name of dependencies) {
      for (let parent = path.dirname(inputPath(name)); path.relative(workspace, parent) !== ''; parent = path.dirname(parent)) {
        if (visitedDirectories.has(parent)) break;
        visitedDirectories.add(parent);
        const packageFile = path.join(parent, 'package.json');
        if (existsSync(packageFile)) packages.push(path.relative(workspace, packageFile));
        if (path.relative(dependencyRoot, parent) === '' || path.dirname(parent) === parent) break;
      }
    }
    const compilerFiles = ['node_modules/typescript/package.json', 'node_modules/typescript/bin/tsc',
      'node_modules/typescript/lib/tsc.js', 'node_modules/typescript/lib/_tsc.js',
      'node_modules/typescript/lib/typescript.js'];
    const stable = sha(encoded({ workspace, dependencyRoot, node: process.version, executable: sha(readFileSync(process.execPath)),
      configs: config.configs, dependencies: digestFiles([...dependencies, ...packages, ...compilerFiles]) }));
    const sources = [...config.sources, ...inputs.filter(name => !dependencyNames.has(name))];
    return { stable, candidate: digestFiles(sources) };
  }

  function readManifest(requireCandidate, allowStale = false) {
    ordinary(cache);
    ordinary(manifest);
    const raw = readFileSync(manifest, 'utf8');
    const value = JSON.parse(raw);
    if (encoded(value) !== raw || encoded(Object.keys(value)) !==
        encoded(['version', 'workspace', 'inputs', 'stable', 'candidate', 'cacheSha256']) ||
        value.version !== 1 || value.workspace !== workspace || !Array.isArray(value.inputs) ||
        value.inputs.some(name => typeof name !== 'string') ||
        value.cacheSha256 !== sha(readFileSync(cache))) fail('invalid or tampered cache');
    const current = identity(value.inputs);
    if ((!allowStale && current.stable !== value.stable) || (requireCandidate && current.candidate !== value.candidate)) {
      fail('stale cache; parent warmup required');
    }
    return { value, current };
  }

  function buildInputs() {
    ordinary(pending);
    const build = JSON.parse(readFileSync(pending, 'utf8'));
    if (!Array.isArray(build.fileNames) || build.fileNames.some(name => typeof name !== 'string')) {
      fail('invalid compiler cache');
    }
    return build.fileNames.map(name => path.relative(workspace, path.resolve(root, name)));
  }

  function compile(warmup) {
    return locked(() => {
      // Warmup is parent-only and cannot replace interrupted or corrupted state.
      const prior = existsSync(manifest) ? readManifest(false, warmup) : null;
      if (!warmup && !prior) fail('missing cache; parent warmup required');
      if (!prior && existsSync(cache)) fail('orphaned cache; owner reconciliation required');
      const inputs = prior?.value.inputs ?? [];
      const before = prior?.current ?? identity(inputs);
      if (prior) copyFileSync(cache, pending);
      const result = spawnSync(process.execPath, [compiler, '--project', path.join(workspace, 'tsconfig.json'),
        '--noEmit', '--incremental', '--tsBuildInfoFile', pending], {
        // Node's optional V8 cache can hang on the runner's long Windows TEMP path.
        cwd: workspace, env: { ...process.env, AVSWORKLOG_TEST_SKIP_DOTENV: '1', NODE_DISABLE_COMPILE_CACHE: '1' },
        stdio: 'inherit', shell: false, windowsHide: true, timeout: 120_000,
      });
      if (result.error || result.signal || result.status === null) fail('compiler interrupted; owner reconciliation required');
      const after = identity(inputs);
      if (encoded(after) !== encoded(before)) fail('candidate changed during typecheck');
      if (result.status !== 0) {
        if (existsSync(pending)) unlinkSync(pending);
        return result.status;
      }
      const nextInputs = buildInputs();
      const current = encoded(nextInputs) === encoded(inputs) ? after : identity(nextInputs);
      const value = { version: 1, workspace, inputs: nextInputs, ...current, cacheSha256: sha(readFileSync(pending)) };
      // Compiler output is durable before publishing its matching manifest. A crash fails closed.
      const fd = openSync(pending, 'r+');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      durableFile(pendingManifest, encoded(value));
      renameSync(pending, cache);
      renameSync(pendingManifest, manifest);
      return 0;
    });
  }

  return {
    ready() { return locked(() => { readManifest(true); return true; }); },
    warmup() { return compile(true); },
    check() { return compile(false); },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, ...extra] = process.argv.slice(2);
  if (!['warmup', 'ready', 'check'].includes(mode) || extra.length || process.cwd() !== WORKSPACE) {
    fail('fixed checkout and warmup|ready|check only');
  }
  const cache = createTypecheckCache(WORKSPACE, CACHE_ROOT);
  process.exitCode = mode === 'ready' ? (cache.ready() ? 0 : 2) : cache[mode]();
}
