import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTypecheckCache } from '../../scripts/automation/fixerrors-typecheck-cache.mjs';

const temporary: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of temporary.splice(0)) {
    const dependencies = path.join(root, 'checkout', 'node_modules');
    if (existsSync(dependencies)) unlinkSync(dependencies);
    rmSync(root, { recursive: true, force: true });
  }
  await new Promise(resolve => setImmediate(resolve));
});

function fixture() {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'SquiresTypecheckFixture-'));
  temporary.push(root);
  const workspace = path.join(root, 'checkout');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(workspace);
  mkdirSync(cacheRoot, { mode: 0o700 });
  if (process.platform === 'win32') {
    execFileSync(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, [
      '-NoProfile', '-NonInteractive', '-Command',
      '& { $ErrorActionPreference="Stop"; $id=[Security.Principal.WindowsIdentity]::GetCurrent().User; ' +
      '$acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($id); ' +
      '$acl.SetAccessRuleProtection($true,$false); ' +
      '$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($id,"FullControl","ContainerInherit,ObjectInherit","None","Allow")); ' +
      'Set-Acl -LiteralPath $args[0] -AclObject $acl }', cacheRoot,
    ], { stdio: 'pipe', windowsHide: true, timeout: 10_000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PSMODULEPATH')) });
  } else chmodSync(cacheRoot, 0o700);
  symlinkSync(realpathSync('node_modules'), path.join(workspace, 'node_modules'), 'junction');
  writeFileSync(path.join(workspace, 'package.json'), '{"type":"module"}');
  writeFileSync(path.join(workspace, 'package-lock.json'), '{"lockfileVersion":3}');
  const config = {
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      skipLibCheck: true, types: [] },
    include: ['*.ts'], exclude: ['tests'],
  };
  writeFileSync(path.join(workspace, 'base.json'), JSON.stringify(config));
  writeFileSync(path.join(workspace, 'tsconfig.json'), '{"extends":"./base.json"}');
  writeFileSync(path.join(workspace, 'api.ts'), 'export const value: string = "ok";\n');
  writeFileSync(path.join(workspace, 'importer.ts'), 'import {value} from "./api"; export const label: string = value;\n');
  const cache = createTypecheckCache(workspace, cacheRoot);
  return { root, workspace, cacheRoot, cache, config,
    write(name: string, bytes: string) { writeFileSync(path.join(workspace, name), bytes); } };
}

describe('protected full application-project TypeScript cache (disposable actual compiler)', () => {
  it('checks under a deeply nested native receipt TEMP without Node compile-cache startup hangs', () => {
    const f = fixture();
    expect(f.cache.warmup()).toBe(0);
    const base = path.join(f.root, 'native-receipts', 'tmp');
    const isolated = path.join(f.root, 'native-receipts', 'a'.repeat(Math.max(1, 229 - base.length)), 'tmp');
    mkdirSync(isolated, { recursive: true });
    vi.stubEnv('TEMP', isolated);
    vi.stubEnv('TMP', isolated);
    f.write('api.ts', 'export const value: string = "edited";\n');
    expect(f.cache.check()).toBe(0);
  }, 30_000);

  it('keeps the OS-account cache path when the check runner redirects home variables', () => {
    const isolated = path.join(tmpdir(), 'synthetic-worker-profile');
    const output = execFileSync(process.execPath, ['--input-type=module', '-e',
      'import {CACHE_ROOT} from "./scripts/automation/fixerrors-typecheck-cache.mjs"; console.log(CACHE_ROOT);'],
    { encoding: 'utf8', windowsHide: true,
      env: { ...process.env, HOME: isolated, USERPROFILE: isolated, HOMEDRIVE: 'Z:', HOMEPATH: '\\synthetic-worker-profile' } });
    expect(output.trim()).toBe(path.join(userInfo().homedir, '.codex', 'cursor-worker', 'squires-typecheck-cache'));
  });

  it('requires parent warmup, never checkout tsbuildinfo, and catches edits and unchanged importer errors', async () => {
    const f = fixture();
    expect(() => f.cache.check()).toThrow();
    expect(() => f.cache.ready()).toThrow();
    f.write('tsconfig.tsbuildinfo', 'untrusted checkout cache');
    expect(f.cache.warmup()).toBe(0);
    expect(f.cache.ready()).toBe(true);
    expect(f.cache.check()).toBe(0);
    await new Promise(resolve => setImmediate(resolve));
    f.write('api.ts', 'export const value: string = 42;\n');
    expect(() => f.cache.ready()).toThrow('stale');
    expect(f.cache.check()).not.toBe(0);
    await new Promise(resolve => setImmediate(resolve));
    f.write('api.ts', 'export const value: number = 42;\n');
    expect(f.cache.check()).not.toBe(0);
    f.write('api.ts', 'export const value: string = "repaired";\n');
    expect(f.cache.check()).toBe(0);
    expect(f.cache.ready()).toBe(true);
    expect(readFileSync(path.join(f.workspace, 'tsconfig.tsbuildinfo'), 'utf8')).toBe('untrusted checkout cache');
    mkdirSync(path.join(f.workspace, 'tests'));
    f.write('tests/excluded.ts', 'const excluded: string = 1;\n');
    expect(f.cache.check()).toBe(0);
  }, 60_000);

  it('blocks config, dependency lock and compiler identity drift until explicit parent warmup', () => {
    const f = fixture();
    expect(f.cache.warmup()).toBe(0);
    f.write('base.json', JSON.stringify({ ...f.config, compilerOptions: {
      ...f.config.compilerOptions, noUnusedLocals: true,
    } }));
    expect(() => f.cache.ready()).toThrow('stale');
    expect(() => f.cache.check()).toThrow('stale');
    expect(f.cache.warmup()).toBe(0);
    f.write('package-lock.json', '{"lockfileVersion":3,"fixture":"changed"}');
    expect(() => f.cache.ready()).toThrow('stale');
    expect(f.cache.warmup()).toBe(0);
    const manifestPath = path.join(f.cacheRoot, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.stable = '0'.repeat(64);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => f.cache.ready()).toThrow('stale');
  }, 60_000);

  it('binds actual dependency declaration and package-resolution bytes, not just lockfiles', () => {
    const f = fixture();
    // Use a private dependency tree so no installed package is modified.
    unlinkSync(path.join(f.workspace, 'node_modules'));
    mkdirSync(path.join(f.workspace, 'node_modules'));
    cpSync(realpathSync('node_modules/typescript'), path.join(f.workspace, 'node_modules/typescript'), { recursive: true });
    const dependency = path.join(f.workspace, 'node_modules', 'fixture-api');
    mkdirSync(dependency);
    writeFileSync(path.join(dependency, 'package.json'), '{"name":"fixture-api","types":"index.d.ts"}');
    writeFileSync(path.join(dependency, 'index.d.ts'), 'export const value: string;\n');
    f.write('api.ts', 'export {value} from "fixture-api";\n');
    try {
      expect(f.cache.warmup()).toBe(0);
      writeFileSync(path.join(dependency, 'index.d.ts'), 'export const value: number;\n');
      expect(() => f.cache.ready()).toThrow('stale');
      expect(() => f.cache.check()).toThrow('stale');
      expect(f.cache.warmup()).not.toBe(0);
      writeFileSync(path.join(dependency, 'index.d.ts'), 'export const value: string;\n');
      writeFileSync(path.join(dependency, 'package.json'), '{"name":"fixture-api","types":"other.d.ts"}');
      expect(() => f.cache.ready()).toThrow('stale');
      writeFileSync(path.join(dependency, 'package.json'), '{"name":"fixture-api","types":"index.d.ts"}');
      expect(f.cache.ready()).toBe(true);
      const compiler = path.join(f.workspace, 'node_modules/typescript/lib/_tsc.js');
      writeFileSync(compiler, readFileSync(compiler, 'utf8') + '\n// Synthetic compiler drift\n');
      expect(() => f.cache.ready()).toThrow('stale');
    } finally {
      rmSync(path.join(f.workspace, 'node_modules'), { recursive: true });
    }
  }, 60_000);

  it('rejects tampered cache, interrupted publication, concurrent lock and cache path escape', () => {
    const f = fixture();
    expect(f.cache.warmup()).toBe(0);
    const cacheFile = path.join(f.cacheRoot, 'cache.tsbuildinfo');
    const bytes = readFileSync(cacheFile);
    writeFileSync(cacheFile, 'tampered');
    expect(() => f.cache.ready()).toThrow('tampered');
    expect(() => f.cache.check()).toThrow('tampered');
    writeFileSync(cacheFile, bytes);
    for (const name of ['next.tsbuildinfo', 'manifest.pending', 'cache.lock']) {
      const target = path.join(f.cacheRoot, name);
      writeFileSync(target, 'interrupted');
      expect(() => f.cache.ready()).toThrow();
      expect(readFileSync(target, 'utf8')).toBe('interrupted');
      unlinkSync(target);
    }
    expect(() => createTypecheckCache(f.workspace, path.join(f.workspace, 'cache'))).toThrow('outside');
    const linked = path.join(f.root, 'linked-cache');
    symlinkSync(f.cacheRoot, linked, 'junction');
    try { expect(() => createTypecheckCache(f.workspace, linked).ready()).toThrow('ordinary'); }
    finally { unlinkSync(linked); }
  }, 30_000);

  it('rejects source candidate drift during a real compiler execution without publishing success', async () => {
    const f = fixture();
    expect(f.cache.warmup()).toBe(0);
    const child = spawn(process.execPath, ['-e',
      'const fs=require("node:fs"); const [lock,file]=process.argv.slice(1); ' +
      'const timer=setInterval(()=>{if(fs.existsSync(lock)){fs.writeFileSync(file,"export const value: string = \\"drift\\";\\n");clearInterval(timer);}},1);',
      path.join(f.cacheRoot, 'next.tsbuildinfo'), path.join(f.workspace, 'api.ts')],
    { stdio: 'ignore', windowsHide: true });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    try {
      expect(() => f.cache.check()).toThrow('candidate changed');
    } finally {
      child.kill();
      await exited;
    }
    expect(existsSync(path.join(f.cacheRoot, 'next.tsbuildinfo'))).toBe(true);
    expect(() => f.cache.ready()).toThrow('interrupted');
  }, 30_000);
});
