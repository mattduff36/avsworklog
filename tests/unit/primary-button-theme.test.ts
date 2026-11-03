import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import postcss, { type AcceptedPlugin, type Root } from 'postcss';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buttonVariants } from '@/components/ui/button';
import postcssConfig from '../../postcss.config.mjs';

const require = createRequire(import.meta.url);
const stylesheetPath = path.join(process.cwd(), 'app', 'globals.css');
let stylesheet: Root;

function valuesFor(selector: string, property: string) {
  const values: string[] = [];
  stylesheet.walkRules(rule => {
    if (rule.selectors.includes(selector)) {
      rule.walkDecls(property, declaration => { values.push(declaration.value); });
    }
  });
  return values;
}

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  try {
    const plugins = Object.entries(postcssConfig.plugins).map(([name, options]) => {
      const createPlugin: (options: object) => AcceptedPlugin = require(name);
      return createPlugin(options);
    });
    const result = await postcss(plugins).process(readFileSync(stylesheetPath, 'utf8'), {
      from: stylesheetPath,
      map: false,
    });
    stylesheet = result.root;
  } finally {
    vi.unstubAllEnvs();
  }
});

describe('primary Button production CSS', () => {
  it('generates the default Button background with a use-site primary token', () => {
    expect(buttonVariants().split(/\s+/)).toEqual(expect.arrayContaining([
      'bg-primary', 'text-primary-foreground', 'hover:bg-primary/90',
    ]));
    expect(valuesFor('.bg-primary', 'background-color')).toContain('hsl(var(--primary))');
  });

  it('generates the default Button foreground with a use-site foreground token', () => {
    expect(valuesFor('.text-primary-foreground', 'color')).toContain('hsl(var(--primary-foreground))');
  });

  it('generates the hover background with 90% opacity and a use-site primary token', () => {
    const values = valuesFor('.hover\\:bg-primary\\/90:hover', 'background-color')
      .map(value => value.replace(/\s+/g, ''));
    expect(values).toContain('color-mix(inoklab,hsl(var(--primary))90%,transparent)');
  });

  it('retains brand/module token pairs and the existing primary foreground override', () => {
    expect(valuesFor(':root', '--primary')).toContain('48 87% 69%');
    expect(valuesFor(':root', '--primary-foreground')).toContain('222 47% 11%');
    expect(valuesFor('.dark', '--primary')).toContain('48 87% 69%');
    expect(valuesFor('.dark', '--primary-foreground')).toContain('222 47% 11%');
    expect(valuesFor('[data-accent=timesheets]', '--primary')).toContain('var(--timesheet-primary)');
    expect(valuesFor('[data-accent=timesheets]', '--primary-foreground')).toContain('210 40% 98%');

    const overrides: string[] = [];
    stylesheet.walkRules(rule => {
      if (rule.selectors.includes('button.bg-primary')) {
        rule.walkDecls('color', declaration => {
          if (declaration.important) overrides.push(declaration.value);
        });
      }
    });
    expect(overrides).toContain('hsl(var(--primary-foreground))');
  });
});
