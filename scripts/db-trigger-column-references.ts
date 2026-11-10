type Token = {
  kind: 'word' | 'identifier' | 'literal' | 'opaque' | 'symbol';
  value: string;
  start: number;
};

type Block =
  | { kind: 'begin' | 'case' | 'loop' }
  | {
    kind: 'if';
    conditionStart: number;
    bodyStart: number;
    phase: 'condition' | 'body' | 'else';
    unreachable: boolean;
    alternative: boolean;
  };

function quotedToken(source: string, start: number, quote: string, escapes: boolean) {
  let value = '';
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === '\\' && escapes) {
      if (++i >= source.length) return null;
      value += source[i];
    } else if (char === quote) {
      if (source[i + 1] !== quote) return { value, end: i + 1 };
      value += quote;
      i++;
    } else {
      // Ordinary backslash strings depend on standard_conforming_strings.
      if (char === '\\' && quote === "'") return null;
      value += char;
    }
  }
  return null;
}

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  for (let i = 0; i < source.length;) {
    const rest = source.slice(i);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      i += whitespace[0].length;
      continue;
    }
    if (rest.startsWith('--')) {
      const end = rest.search(/[\r\n]/);
      i = end < 0 ? source.length : i + end;
      continue;
    }
    if (rest.startsWith('/*')) {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        if (source.startsWith('/*', i)) {
          depth++;
          i += 2;
        } else if (source.startsWith('*/', i)) {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      if (depth !== 0) return null;
      continue;
    }
    if (rest.startsWith('*/') || /^u&['"]/i.test(rest)) return null;

    const escaped = /^e'/i.test(rest);
    const quote = escaped ? "'" : source[i];
    if (quote === "'" || quote === '"') {
      const quoted = quotedToken(source, i + (escaped ? 1 : 0), quote, escaped);
      if (!quoted) return null;
      tokens.push({
        kind: escaped ? 'opaque' : quote === "'" ? 'literal' : 'identifier',
        value: quoted.value,
        start: i,
      });
      i = quoted.end;
      continue;
    }
    const dollar = /^\$(?:[a-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/i.exec(rest);
    if (dollar) {
      const end = source.indexOf(dollar[0], i + dollar[0].length);
      if (end < 0) return null;
      tokens.push({ kind: 'opaque', value: source.slice(i, end + dollar[0].length), start: i });
      i = end + dollar[0].length;
      continue;
    }
    if (source[i] === '$') return null;
    const word = /^[a-z_\u0080-\uffff][\w$\u0080-\uffff]*/i.exec(rest);
    if (word) {
      tokens.push({ kind: 'word', value: word[0].toLowerCase(), start: i });
      i += word[0].length;
    } else {
      tokens.push({ kind: 'symbol', value: source[i], start: i++ });
    }
  }
  return tokens;
}

function isOtherSchema(condition: Token[], schema: string): boolean {
  while (condition[0]?.value === '(' && condition.at(-1)?.value === ')') {
    let depth = 0;
    const wrapsCondition = condition.every((token, index) => {
      if (token.value === '(' && token.kind === 'symbol') depth++;
      if (token.value === ')' && token.kind === 'symbol') depth--;
      return depth > 0 || index === condition.length - 1;
    });
    if (!wrapsCondition) break;
    condition = condition.slice(1, -1);
  }
  return condition.length === 3
    && condition[0].kind === 'word' && condition[0].value === 'tg_table_schema'
    && condition[1].kind === 'symbol' && condition[1].value === '='
    && condition[2].kind === 'literal' && condition[2].value !== schema;
}

function unreachableBranches(tokens: Token[], schema: string): Array<[number, number]> {
  const blocks: Block[] = [];
  const delimiters: string[] = [];
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const block = blocks.at(-1);
    if (token.kind === 'symbol') {
      if (token.value === '(' || token.value === '[') delimiters.push(token.value);
      if (token.value === ')' && delimiters.pop() !== '(') return [];
      if (token.value === ']' && delimiters.pop() !== '[') return [];
      if (token.value === ';' && block?.kind === 'if' && block.phase === 'condition') return [];
      continue;
    }
    // A declaration, assignment or other non-condition use may shadow/mutate
    // the trigger variable, so its value is no longer proven by the table.
    if ((token.kind === 'word' || token.kind === 'identifier')
      && token.value.toLowerCase() === 'tg_table_schema' && tokens[i - 1]?.value !== '.'
      && (block?.kind !== 'if' || block.phase !== 'condition')) return [];
    if (token.kind !== 'word') continue;
    switch (token.value) {
      case 'begin':
      case 'case':
      case 'loop':
        blocks.push({ kind: token.value });
        break;
      case 'if':
        if (block?.kind === 'if' && block.phase === 'condition') return [];
        blocks.push({
          kind: 'if', conditionStart: i + 1, bodyStart: -1,
          phase: 'condition', unreachable: false, alternative: false,
        });
        break;
      case 'then':
        if (block?.kind === 'case') break;
        if (block?.kind !== 'if' || block.phase !== 'condition') return [];
        if (!block.alternative) {
          block.unreachable = isOtherSchema(tokens.slice(block.conditionStart, i), schema);
          block.bodyStart = token.start + token.value.length;
        }
        block.phase = 'body';
        break;
      case 'else':
      case 'elsif':
        if (block?.kind === 'case' && token.value === 'else') break;
        if (block?.kind !== 'if' || block.phase !== 'body') return [];
        block.alternative = true;
        block.phase = token.value === 'else' ? 'else' : 'condition';
        block.conditionStart = i + 1;
        break;
      case 'end': {
        const suffix = tokens[i + 1];
        // A SQL CASE expression can end immediately before a FOR ... LOOP.
        const endKind = suffix?.kind === 'word'
          && ['if', 'loop', 'case'].includes(suffix.value)
          && !(block?.kind === 'case' && suffix.value === 'loop') ? suffix.value : null;
        if (!block || (endKind ? block.kind !== endKind
          : block.kind !== 'begin' && block.kind !== 'case')) return [];
        if (endKind === 'loop' || endKind === 'case') {
          const after = tokens[i + 2];
          const labeledLoop = endKind === 'loop'
            && (after?.kind === 'word' || after?.kind === 'identifier')
            && tokens[i + 3]?.value === ';';
          if (after?.value !== ';' && !labeledLoop) return [];
        }
        if (block.kind === 'begin' && suffix?.value !== ';') {
          const labeledEnd = (suffix?.kind === 'word' || suffix?.kind === 'identifier')
            && tokens[i + 2]?.value === ';';
          if (!labeledEnd && !(blocks.length === 1 && !suffix)) return [];
        }
        if (block.kind === 'if') {
          if (block.phase === 'condition' || tokens[i + 2]?.value !== ';') return [];
          if (block.unreachable && !block.alternative) {
            ranges.push([block.bodyStart, token.start]);
          }
        }
        blocks.pop();
        if (endKind) i++;
        break;
      }
    }
  }
  return blocks.length === 0 && delimiters.length === 0 ? ranges : [];
}

/**
 * Only a balanced, pure TG_TABLE_SCHEMA = 'literal' IF without alternatives
 * proves a branch unreachable. Unknown control flow keeps column validation.
 */
export function extractTriggerColumnReferences(source: string, tableSchema: string): Set<string> {
  const tokens = tokenize(source);
  const excluded = tokens ? unreachableBranches(tokens, tableSchema) : [];
  const references = new Set<string>();
  // Preserve scanning outside proven exclusions, including dynamic SQL text.
  // Unsupported syntax or malformed blocks therefore retain validation.
  for (const match of source.matchAll(/\b(?:NEW|OLD)\.(\w+)/gi)) {
    if (!excluded.some(([start, end]) => match.index >= start && match.index < end)) {
      references.add(match[1].toLowerCase());
    }
  }
  return references;
}
