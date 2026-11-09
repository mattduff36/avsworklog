import { createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfigSchema, MergeError, configHash, encryptedFileBackup, encryptSnapshot, hash,
  parseCli, runCli, safeFailure, validateConnection, validateExternalPath,
  type MergeConfig, type Snapshot } from '../../scripts/maintenance/merge-user-accounts';

const config = (): MergeConfig => ({ version:1,runId:randomUUID(),sourceId:randomUUID(),targetId:randomUUID(),
  sourceEmail:'source@example.test',targetEmail:'target@example.test',
  projectRef:'syntheticproject',schemaHash:'0'.repeat(64),sourceProfileHash:'1'.repeat(64),targetProfileHash:'2'.repeat(64),
  employeeId:'fixture-employee',duplicates:Array.from({length:7},()=>({source:randomUUID(),target:randomUUID()})),
  targetAdjustmentId:randomUUID(),expectedSourceAbsences:29,expectedHolidayKeys:16,expectedPermissionOverrides:23,
  holidayYears:[{year:2025,used:28,carryIn:0,balance:0},{year:2026,used:30,carryIn:0,balance:-2}],
  backupPath:path.join(os.tmpdir(),'synthetic-backup'),receiptPath:path.join(os.tmpdir(),'synthetic-receipt'),backupProtectionReviewed:true });

let temp: string;
beforeAll(async()=>{temp=await fs.mkdtemp(path.join(os.tmpdir(),'account-merge-unit-'));});
afterAll(async()=>{for(const name of await fs.readdir(temp)) await fs.unlink(path.join(temp,name)); await fs.rmdir(temp);});

describe('account merge offline safety',()=>{
  it('typechecks the maintenance entrypoint without an app build',()=>{
    const program=ts.createProgram([path.resolve('scripts/maintenance/merge-user-accounts.ts')],{
      noEmit:true,strict:true,noUnusedLocals:true,noUnusedParameters:true,skipLibCheck:true,
      target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
      esModuleInterop:true,types:['node'],
    });
    const diagnostics=ts.getPreEmitDiagnostics(program);
    expect(diagnostics.map((d)=>`${d.file?.fileName}:${d.start}: ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`)).toEqual([]);
  },60000);
  it('AM-CLI-001 defaults to an offline dry run; strict CLI refuses ambiguous or extra options',()=>{
    expect(parseCli(['--config','external.json'])).toMatchObject({mode:'inspect',live:false,apply:false});
    for(const args of [[],['--config','a','--config','b'],['--config','a','--mode','all'],
      ['--config','a','--apply'],['--config','a','--mode','merge','--live'],['--config','a','--unknown','secret'],
      ['--config','a','--mode'],['--config','a','--live','--live'],['--config','a','--live','--apply']])
      expect(()=>parseCli(args)).toThrow();
  });
  it('rejects pooled, remote, wrong project, fallback and query-bearing connections without leaking them',()=>{
    const value='postgresql://postgres.syntheticproject:not-a-real-password@aws-0-region.pooler.supabase.com:5432/postgres';
    expect(validateConnection(value,'syntheticproject','5432').port).toBe('5432');
    expect(validateConnection('postgresql://postgres:fixture@db.syntheticproject.supabase.co:5432/postgres','syntheticproject','5432').hostname)
      .toBe('db.syntheticproject.supabase.co');
    for(const bad of [undefined,value.replace(':5432',':6543'),value.replace('syntheticproject','otherproject'),
      value+'?sslmode=disable',value.replace('aws-0-region.pooler.supabase.com','127.0.0.1'),value.replace('/postgres','/shared')]) {
      try {validateConnection(bad,'syntheticproject','5432');expect.unreachable();}
      catch(error) {expect(JSON.stringify(safeFailure(error))).not.toContain('not-a-real-password');}
    }
    expect(()=>validateConnection(value,'syntheticproject','6543')).toThrow('SESSION_CONNECTION_REQUIRED');
  });
  it('validates distinct identities, exact duplicate approvals, strict fields and stable config hashes',()=>{
    const c=config();expect(ConfigSchema.parse(c)).toEqual(c);
    expect(configHash(c)).toBe(configHash({...c}));
    expect(()=>ConfigSchema.parse({...c,sourceId:c.targetId})).toThrow();
    expect(()=>ConfigSchema.parse({...c,duplicates:c.duplicates.slice(1)})).toThrow();
    expect(()=>ConfigSchema.parse({...c,password:'do-not-copy'})).toThrow();
    expect(()=>ConfigSchema.parse({...c,backupProtectionReviewed:false})).toThrow();
    expect(configHash({...c,employeeId:'changed'})).not.toBe(configHash(c));
  });
  it('dry run does not inspect a URL, construct an Auth client, connect or write receipts',async()=>{
    const c=config();const file=path.join(temp,'config.json');await fs.writeFile(file,JSON.stringify(c));
    const env=new Proxy({}, {get(){throw new Error('environment must remain untouched');}});
    const before=await fs.readdir(temp);
    expect(await runCli(['--config',file,'--mode','merge'],env)).toEqual({dryRun:true,mode:'merge',configHash:configHash(c)});
    expect(await fs.readdir(temp)).toEqual(before);
    await expect(runCli(['--config',file,'--mode','merge','--apply'],{})).rejects.toThrow('EXACT_TARGET_CONFIRMATION_REQUIRED');
    await expect(runCli(['--config',file,'--live','--confirm-target',c.projectRef,'--confirm-port','5432'],{POSTGRES_URL:'forbidden-fallback'}))
      .rejects.toThrow('SESSION_CONNECTION_REQUIRED');
  });
  it('anchors external config protection to the checkout, not the caller working directory',async()=>{
    const c=config();const file=path.join(temp,'external-config.json');await fs.writeFile(file,JSON.stringify(c));
    const internal=path.resolve('scripts','maintenance','merge-user-accounts.ts');
    const cwd=vi.spyOn(process,'cwd').mockReturnValue(temp);
    try {
      expect(await runCli(['--config',file],{})).toMatchObject({dryRun:true});
      await expect(runCli(['--config',internal],{})).rejects.toThrow('CONFIG_INSIDE_REPOSITORY');
    } finally {cwd.mockRestore();}
  });
  it('preflights backup and receipt prefixes before reading connection credentials or mutating',async()=>{
    for(const field of ['backupPath','receiptPath'] as const) {
      const c={...config(),[field]:path.join(process.cwd(),'forbidden-prefix')};
      const file=path.join(temp,`${field}-config.json`);await fs.writeFile(file,JSON.stringify(c));
      const env=new Proxy({}, {get(){throw new Error('credentials must not be read');}});
      await expect(runCli(['--config',file,'--mode','merge','--apply','--confirm-target',c.projectRef,'--confirm-port','5432'],env))
        .rejects.toThrow('BACKUP_INSIDE_REPOSITORY');
    }
  });
  it('encrypts authenticated recovery bytes, writes exclusively and verifies ciphertext readback',async()=>{
    const key=randomBytes(32);const snapshot:Snapshot={version:1,phase:'merge',runId:randomUUID(),configHash:'a'.repeat(64),
      schemaHash:'b'.repeat(64),rows:{'auth.users':['{"encrypted_password":"fixture-secret"}']},tableHashes:{}};
    const encrypted=encryptSnapshot(snapshot,key);
    expect(encrypted.toString()).not.toContain('fixture-secret');
    const data=JSON.parse(encrypted.toString());
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(data.iv,'base64'));
    decipher.setAAD(Buffer.from(data.aad,'base64'));decipher.setAuthTag(Buffer.from(data.tag,'base64'));
    expect(JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.ciphertext,'base64')),decipher.final()]).toString())).toEqual(snapshot);
    const backup=await encryptedFileBackup(path.join(temp,'backup'),key,process.cwd())(snapshot);
    expect(backup.snapshotHash).toBe(hash(snapshot));expect(backup.ciphertextHash).toBe(hash(await fs.readFile(backup.path)));
    await expect(validateExternalPath(backup.path,process.cwd())).rejects.toThrow('BACKUP_PATH_ALREADY_EXISTS');
    await expect(validateExternalPath(path.join(process.cwd(),'forbidden.enc'),process.cwd())).rejects.toThrow('BACKUP_INSIDE_REPOSITORY');
    await expect(validateExternalPath('relative.enc',process.cwd())).rejects.toThrow('BACKUP_PATH_NOT_ABSOLUTE');
    expect(()=>encryptSnapshot(snapshot,Buffer.alloc(31))).toThrow('BACKUP_KEY_REQUIRED');
  });
  it('outputs only allowlisted errors, never raw SQL/Auth/Zod payloads',()=>{
    expect(safeFailure(new Error('postgresql://secret:password@private.example/token'))).toEqual({error:'ACCOUNT_MERGE_FAILED'});
    expect(safeFailure(new MergeError('SCHEMA_DRIFT'))).toEqual({error:'SCHEMA_DRIFT'});
    expect(safeFailure(new MergeError('INCOMING_REFERENCE:public.message_recipients'))).toEqual({error:'INCOMING_REFERENCE:public.message_recipients'});
    expect(safeFailure(new MergeError('RAW_SECRET=123'))).toEqual({error:'ACCOUNT_MERGE_FAILED'});
  });
});