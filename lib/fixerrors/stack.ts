export interface SourceFileRef { file: string; line?: number; column?: number }

export function parseStackTrace(stack: string | null): SourceFileRef[] {
  if (!stack) return [];
  const refs: SourceFileRef[] = [];
  const seen = new Set<string>();
  const webpackPattern = /webpack-internal:\/\/\/[^\r\n]*?\.\/([^:\r\n]+?\.(?:tsx?|jsx?))(?::(\d+))?(?::(\d+))?(?=\)|$|\s)/g;
  const directPattern = /(?:\/app\/|\.\/)((?:app|lib|components|hooks|utils|services)[^:\r\n]*?\.(?:tsx?|jsx?))(?::(\d+))?(?::(\d+))?(?=\)|$|\s)/g;
  for (const pattern of [webpackPattern, directPattern]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(stack)) !== null) {
      if (pattern === directPattern) {
        const start = stack.lastIndexOf('\n', match.index) + 1;
        const end = stack.indexOf('\n', match.index);
        const line = stack.slice(start, end === -1 ? stack.length : end);
        if (line.includes('.next/') || line.includes('_next/')) continue;
      }
      const file = match[1];
      const line = match[2] ? parseInt(match[2], 10) : undefined;
      const column = match[3] ? parseInt(match[3], 10) : undefined;
      if (file.includes('node_modules') || file.startsWith('__')) continue;
      const key = `${file}:${line || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ file, line, column });
      }
    }
  }
  return refs;
}
