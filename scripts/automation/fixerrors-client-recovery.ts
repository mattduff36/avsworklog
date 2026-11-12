import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type ts from 'typescript';

const require = createRequire(import.meta.url);
const business = /payroll|timesheet|invoice|quote|payment|financial|billing|finance/iu;
const protectedArea = /api|server|auth|security|permission|admin|debug|rbac|session|token|credential|secret|password|policy|enroll|fixerrors|supabase|migration|transaction|mutex|concurren|kiosk|webauthn/iu;
export function isGuardedBusinessClient(name: string): boolean {
  return /^(?:app|components)\/[A-Za-z0-9_()/.[\]-]+\.tsx$/u.test(name) &&
    !name.split('/').some(part => part.startsWith('.')) && business.test(name) && !protectedArea.test(name);
}

/** Remove only local error recovery from both versions, then compare everything else. */
export function assertClientRecoveryChange(name: string, before: string, after: string): void {
  const t: typeof ts = require('typescript');
  const parse = (text: string) => t.createSourceFile(name, text.replace(/\r\n/gu, '\n'), t.ScriptTarget.Latest, true, t.ScriptKind.TSX);
  const base = parse(before), next = parse(after);
  const fail = (): never => { throw new Error('Review the proposed client diff: it changes code beyond HTTP recovery and local UI state. Verify affected permission, data or rendering behaviour before release.'); };
  const visit = (n: ts.Node, fn: (n: ts.Node) => void) => { fn(n); t.forEachChild(n, child => visit(child, fn)); };
  const text = (n: ts.Node) => n.getText();
  const statusCode = (expr: ts.Expression): string | undefined =>
    t.isBinaryExpression(expr) && expr.operatorToken.kind === t.SyntaxKind.EqualsEqualsEqualsToken &&
    t.isNumericLiteral(expr.right) && /^[45]\d\d$/u.test(expr.right.text) &&
    /^(?:\w+\.status(?:Code)?|(?:http|response|error)?status(?:Code)?|(?:get|read|extract)\w*Status(?:Code)?\(\w+\))$/iu.test(text(expr.left)) ? expr.right.text : undefined;
  if (!isGuardedBusinessClient(name) || ![base, next].every(file => file.statements[0] &&
      t.isExpressionStatement(file.statements[0]) && t.isStringLiteral(file.statements[0].expression) &&
      file.statements[0].expression.text === 'use client' &&
      !(file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length)) fail();

  const knownHandlers = new Set<string>(), setters = new Set<string>(), localFlags = new Set<string>();
  const baselineConditions = new Set<string>();
  const baselineStatusAccess = new Set<string>();
  visit(base, n => {
    if (t.isIfStatement(n)) {
      if (t.isBinaryExpression(n.expression) &&
          /^(?:\w+|\w+\.current)\s*(?:===|!==)\s*(?:\w+|\w+\.current)$/u.test(text(n.expression))) {
        baselineConditions.add(text(n.expression));
      }
      const status = statusCode(n.expression);
      if (status && t.isBinaryExpression(n.expression)) baselineStatusAccess.add(text(n.expression.left));
      if (status && t.isBlock(n.parent) && t.isCatchClause(n.parent.parent)) visit(n.thenStatement, child => {
        if (t.isCallExpression(child) && t.isIdentifier(child.expression) &&
            /recover|(?:handle|refresh|redirect).*(?:session|auth|access)/iu.test(text(child.expression))) knownHandlers.add(status + ':' + text(child));
      });
    }
    if (!t.isVariableDeclaration(n) || !n.initializer || !t.isCallExpression(n.initializer)) return;
    if (text(n.initializer.expression) === 'useState' && t.isArrayBindingPattern(n.name) && n.name.elements.length === 2) {
      setters.add(text(n.name.elements[1])); localFlags.add(text(n.name.elements[0]));
    }
    if (text(n.initializer.expression) === 'useRef' && t.isIdentifier(n.name)) localFlags.add(n.name.text + '.current');
  });
  const project = (file: ts.SourceFile) => {
    const spans: ts.Node[] = [], recoveryImports = new Set<string>(), groups: number[] = [];
    for (const node of file.statements) {
      if (!t.isImportDeclaration(node) || !t.isStringLiteral(node.moduleSpecifier) ||
          node.moduleSpecifier.text !== '@/lib/app-auth/recovery-bridge') continue;
      const bindings = node.importClause?.namedBindings;
      if (node.importClause?.name || !bindings || !t.isNamedImports(bindings) ||
          !bindings.elements.every(item => !item.propertyName && item.name.text === 'handleAuthFailureStatus')) continue;
      recoveryImports.add('handleAuthFailureStatus');
      spans.push(node);
    }
    visit(file, n => {
      // A failure may prevent an already-local dialog from opening, even if it
      // had previously been opened unconditionally. Its data/permission guard stays intact.
      if (file === next && t.isIfStatement(n) && !base.text.includes(text(n)) && !n.elseStatement && localFlags.has(text(n.expression)) &&
          t.isReturnStatement(n.thenStatement) && !n.thenStatement.expression &&
          t.isBlock(n.parent) && n.parent.statements.some(s => t.isExpressionStatement(s) &&
            t.isCallExpression(s.expression) && setters.has(text(s.expression.expression)) &&
            /(?:open|visible)$/iu.test(text(s.expression.expression)) && text(s.expression.arguments[0] ?? s) === 'true')) spans.push(n);
      if (!t.isCatchClause(n)) return;
      let count = 0;
      for (const branch of n.block.statements) {
        if (!t.isIfStatement(branch) || branch.elseStatement) continue;
        const status = statusCode(branch.expression);
        if (!status || !t.isBinaryExpression(branch.expression)) continue;
        if (t.isCallExpression(branch.expression.left) && !baselineStatusAccess.has(text(branch.expression.left))) continue;
        let handled = false, logged = false;
        const clientEffect = (s: ts.Statement): boolean => {
          if (t.isBlock(s)) return s.statements.every((stmt, i) =>
            (!t.isReturnStatement(stmt) || i === s.statements.length - 1) && clientEffect(stmt));
          if (t.isIfStatement(s)) return !s.elseStatement && baselineConditions.has(text(s.expression)) && clientEffect(s.thenStatement);
          if (t.isReturnStatement(s)) return handled && (!s.expression || s.expression.kind === t.SyntaxKind.FalseKeyword);
          if (!t.isExpressionStatement(s)) return false;
          const call = t.isAwaitExpression(s.expression) ? s.expression.expression : s.expression;
          if (!t.isCallExpression(call)) return false;
          const callee = text(call.expression), args = call.arguments.map(text);
          if (knownHandlers.has(status + ':' + text(call)) ||
              recoveryImports.has(callee) && args.length === 1 && args[0] === status ||
              /^toast\.(info|warning|error)$/u.test(callee) && args.length === 1 && t.isStringLiteral(call.arguments[0])) handled = true;
          else if (callee === 'console.error' && args.length === 2 && t.isStringLiteral(call.arguments[0]) &&
              args[1] === n.variableDeclaration?.name.getText()) logged = true;
          else return setters.has(callee) && args.length === 1 && ['false', 'null', '[]', "''", '""'].includes(args[0]);
          return true;
        };
        if (clientEffect(branch.thenStatement) && handled && (Number(status) < 500 && status !== '403' || logged)) {
          spans.push(branch);
          count++;
        }
      }
      groups.push(count);
    });
    let rest = file.text;
    for (const n of spans.sort((a, b) => b.pos - a.pos)) rest = rest.slice(0, n.pos) + rest.slice(n.end);
    return { rest, groups };
  };
  const old = project(base), revised = project(next);
  if (old.rest !== revised.rest || !revised.groups.some(Boolean) || old.groups.some((n, i) => n > revised.groups[i]) || before === after) fail();
}

export function assertWorktreeClientRecovery(cwd: string, names: string[]): void {
  for (const name of names.filter(isGuardedBusinessClient)) {
    const base = execFileSync('git', ['show', 'HEAD:' + name], { cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    assertClientRecoveryChange(name, base, readFileSync(resolve(cwd, name), 'utf8'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--verify-worktree') throw new Error('Invalid recovery check invocation');
  const names = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', 'HEAD'], { encoding: 'utf8' });
  assertWorktreeClientRecovery(process.cwd(), names.split('\0').filter(Boolean));
}
