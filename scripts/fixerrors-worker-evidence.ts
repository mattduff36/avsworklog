import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, join, posix, resolve, sep } from 'node:path';
import type { AutoRetrieval } from './fixerrors-auto';
import type { ErrorLogEntry } from './fixerrors-retrieval';
import { isFixerrorsSourcePath } from './fixerrors-auto';
import { retrieveIncidents, type KnowledgeStore } from './fixerrors-knowledge';

type Cluster = AutoRetrieval['clusters'][number];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

// Worker diagnostics are source templates, never arbitrary runtime prose or
// customer URL segments. Exact row bindings remain private on the server.
export function createWorkerEvidenceProjector(repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const sources = new Map<string, string>();
  const routes: string[] = [];
  function pages(directory: string, segments: string[]) {
    if (!existsSync(directory) || !lstatSync(directory).isDirectory() ||
        realpathSync(directory) !== resolve(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pages(join(directory, entry.name),
        entry.name.startsWith('(') || entry.name.startsWith('@') ? segments : [...segments, entry.name]);
      else if (/^page\.[jt]sx?$/u.test(entry.name)) routes.push('/' + segments.join('/'));
    }
  }
  pages(join(root, 'app'), []);
  const rank = (segment: string | undefined) => segment === undefined ? 4 :
    segment.startsWith('[[...') ? 0 : segment.startsWith('[...') ? 1 : segment.startsWith('[') ? 2 : 3;
  routes.sort((a, b) => {
    const left = a.split('/'), right = b.split('/');
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const difference = rank(right[index]) - rank(left[index]);
      if (difference) return difference;
    }
    return a.localeCompare(b);
  });
  function source(name: string): string | null {
    const file = resolve(root, ...name.split('/'));
    if (!isFixerrorsSourcePath(name) || !file.startsWith(root + sep) || !existsSync(file) ||
        !lstatSync(file).isFile() || realpathSync(file) !== file) return null;
    if (!sources.has(name)) sources.set(name, readFileSync(file, 'utf8'));
    return sources.get(name)!;
  }
  return (cluster: Cluster, knowledge: KnowledgeStore, occurrences: ErrorLogEntry[] = []): Cluster => {
    const sourceFiles = cluster.sourceFiles.filter(name => source(name) !== null);
    const relatedSourceFiles = [...new Set(sourceFiles.flatMap(name => {
      const imports = [...source(name)!.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/gu)];
      return imports.flatMap(([, specifier]) => {
        const base = specifier.startsWith('@/') ? specifier.slice(2) : specifier.startsWith('.')
          ? posix.normalize(posix.join(posix.dirname(name), specifier)) : '';
        if (!base) return [];
        const found = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
          .find(candidate => source(candidate) !== null);
        return found ? [found] : [];
      });
    }))].slice(0, 12);
    const content = sourceFiles.map(name => source(name)).join('\n');
    const literals = [...content.matchAll(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/gu)]
      .map(match => match[2]).filter(value => value.length >= 4 && value.length <= 200 && !/\\[rn]/u.test(value));
    const literal = (value: string | null) => value !== null && literals.includes(value);
    // Emit UI observations only when every occurrence agrees and the label is
    // explicitly present in the identified page's JSX or notification call.
    const observedAction = ({ additional_data }: ErrorLogEntry) => {
      const action = additional_data?.userAction;
      if (!action || typeof action !== 'object' || Array.isArray(action)) return undefined;
      const { actionType, ageMs, label } = action as Record<string, unknown>;
      if ((actionType !== 'click' && actionType !== 'submit') ||
          typeof ageMs !== 'number' || !Number.isInteger(ageMs) || ageMs < 0 || ageMs > 45_000 ||
          typeof label !== 'string' || !/^[A-Za-z][A-Za-z -]{0,63}$/u.test(label)) return undefined;
      return { kind: actionType, label } as const;
    };
    const action = occurrences.length ? observedAction(occurrences[0]) : undefined;
    const actionLabel = action ? escape(action.label) : '';
    const actionInJsx = new RegExp(
      'aria-label\\s*=\\s*["\\x27]' + actionLabel + '["\\x27]|>\\s*' + actionLabel + '\\s*<|' +
      '>\\s*\\{[^{}<>]{0,160}["\\x27]' + actionLabel + '["\\x27][^{}<>]{0,160}\\}\\s*<', 'u');
    const recentAction = action && actionInJsx.test(content) && occurrences.every(entry => {
      const other = observedAction(entry);
      return other?.kind === action.kind && other.label === action.label;
    }) ? action : undefined;
    const feedback = occurrences[0]?.additional_data?.userMessage;
    const visibleMessage = typeof feedback === 'string' && /^[A-Za-z][A-Za-z .,!?'-]{0,159}$/u.test(feedback) &&
      new RegExp('\\btoast\\.(?:error|warning|info|success)\\(\\s*["\\x27]' + escape(feedback) + '["\\x27]', 'u').test(content) &&
      occurrences.every(entry => entry.additional_data?.userMessage === feedback) ? feedback : undefined;
    const message = (value: string) => {
      const consoleValue = value.replace(/^(?:console[. ]error:?\s*|\[console\.error\]\s*)/iu, '');
      for (const template of literals) {
        const parts = template.split(/\$\{[^}]*\}/u);
        if (parts.join('').trim().length < 12) continue;
        if (new RegExp(`^${parts.map(escape).join('.*?')}$`, 'u').test(value)) return parts.join('[dynamic]');
        if (parts.length === 1 && template.trim().length >= 12 &&
            /(?:error|fail|unable|invalid)/iu.test(template) &&
            consoleValue.startsWith(template) &&
            /^(?:\s|:)/u.test(consoleValue.slice(template.length))) {
          return `${template} [dynamic]`;
        }
      }
      if (/cannot read properties of (?:undefined|null)/iu.test(value)) return 'Cannot read properties of an absent value';
      if (/is not a function/iu.test(value)) return 'Runtime value is not callable';
      if (/maximum update depth/iu.test(value)) return 'Maximum update depth exceeded';
      if (/failed to fetch|network|econn|enotfound/iu.test(value)) return 'Network request failed';
      if (/validation|invalid input|required field/iu.test(value)) return 'Input validation failed';
      return 'Runtime failure; inspect the referenced source and diagnostic class';
    };
    const component = (value: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value) &&
      new RegExp(`\\b(?:function|class|const)\\s+${escape(value)}\\b`, 'u').test(content)
      ? value : sourceFiles[0] ? basename(sourceFiles[0]).replace(/\.[jt]sx?$/u, '') : 'NoComponent';
    const route = routes.find(template => new RegExp('^' + template.split('/').slice(1).map(segment =>
      segment.startsWith('[[...') ? '(?:/.*)?' : segment.startsWith('[...') ? '/.+' :
        segment.startsWith('[') ? '/[^/]+' : '/' + escape(segment)).join('') + '/?$', 'u').test(cluster.query.route)) ??
      (literal(cluster.query.route) && cluster.query.route.startsWith('/') ? cluster.query.route : 'NoPage');
    const family = /^(?:auth-permissions-security|database-persistence|money-billing|concurrency-transaction|external-network|user-input)$/u
      .test(cluster.rootCauseFamily) ? cluster.rootCauseFamily : sourceFiles[0] ? `source:${sourceFiles[0]}` : 'runtime-error';
    const query = {
      ...cluster.query, errorContextId: cluster.query.errorContextId && literal(cluster.query.errorContextId) &&
        new RegExp('\\berrorContextId\\s*(?::|=)\\s*["\\x27]' + escape(cluster.query.errorContextId) + '["\\x27]', 'u').test(content)
        ? cluster.query.errorContextId : null,
      route, component: component(cluster.query.component), sourceFile: sourceFiles[0] ?? null,
      normalizedMessage: message(cluster.query.normalizedMessage), rootCauseFamily: family,
    };
    return {
      ...cluster, rootCauseFamily: family, query, sourceFiles, relatedSourceFiles,
      ...(cluster.diagnostics ? { diagnostics: {
        ...cluster.diagnostics,
        ...(recentAction ? { recentAction } : {}),
        ...(visibleMessage ? { visibleMessage } : {}),
        frames: cluster.diagnostics.frames.filter(frame => source(frame.file) !== null),
      } } : {}),
      patterns: cluster.patterns.map(pattern => ({
        ...pattern, component: component(pattern.component),
        errorType: /^(?:Error|TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|ChunkLoadError)$/u
          .test(pattern.errorType) ? pattern.errorType : 'Error',
        normalizedMessage: message(pattern.normalizedMessage),
        sourceFiles: pattern.sourceFiles.filter(name => source(name) !== null),
      })),
      priorResolutions: retrieveIncidents(knowledge, query),
      matchingAllowed: cluster.matchingAllowed !== false && JSON.stringify(query) === JSON.stringify(cluster.query),
    };
  };
}
