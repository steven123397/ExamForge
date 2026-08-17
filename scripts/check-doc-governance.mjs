import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const required = ['AGENTS.md', 'CONTEXT.md', 'docs/adr', 'docs/archive/README.md'];
const forbidden = ['docs/design', 'docs/plan', 'docs/status', 'docs/index.md', 'CLAUDE.md'];
const activeRoots = ['AGENTS.md', 'CONTEXT.md', 'docs/agents', 'docs/adr', 'docs/background'];
const archiveEntryFiles = [
  'docs/archive/README.md',
  'docs/archive/design/README.md',
  'docs/archive/plan/README.md',
  'docs/archive/status/README.md',
  'docs/archive/design/CONTEXT.md',
];
const errors = [];

for (const relative of required) {
  if (!existsSync(join(root, relative))) errors.push(`missing required path: ${relative}`);
}
for (const relative of forbidden) {
  if (existsSync(join(root, relative))) errors.push(`forbidden active path remains: ${relative}`);
}

const retiredPaths = ['docs/design/', 'docs/plan/', 'docs/status/', 'docs/index.md'];
function checkRetiredPaths(text, relative, scope) {
  for (const oldPath of retiredPaths) {
    if (text.includes(oldPath)) errors.push(`${scope} references retired path ${oldPath}: ${relative}`);
  }
}

const adrDirectory = join(root, 'docs/adr');
const adrFiles = existsSync(adrDirectory)
  ? readdirSync(adrDirectory).filter((name) => /^\d{4}-.*\.md$/.test(name)).sort()
  : [];
const expected = Array.from({ length: adrFiles.length }, (_, index) => `${String(index + 1).padStart(4, '0')}-`);
adrFiles.forEach((name, index) => {
  if (!name.startsWith(expected[index])) errors.push(`ADR numbering gap or reorder: ${name}`);
  const text = readFileSync(join(adrDirectory, name), 'utf8');
  if (!/^status:\s*(accepted|implemented|partially-implemented|superseded by ADR-\d{4}|retired)\s*$/m.test(text)) {
    errors.push(`ADR missing valid lifecycle status: docs/adr/${name}`);
  }
});

function walk(relative) {
  const absolute = join(root, relative);
  if (!existsSync(absolute)) return;
  const entries = readdirSync(absolute, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(relative, entry.name);
    if (entry.isDirectory()) walk(child);
    else if (entry.name.endsWith('.md')) {
      const text = readFileSync(join(root, child), 'utf8');
      checkRetiredPaths(text, child, 'active doc');
    }
  }
}
for (const relative of activeRoots) {
  if (relative.endsWith('.md')) {
    const text = readFileSync(join(root, relative), 'utf8');
    checkRetiredPaths(text, relative, 'active doc');
  } else walk(relative);
}
for (const relative of archiveEntryFiles) {
  const absolute = join(root, relative);
  if (!existsSync(absolute)) {
    errors.push(`missing archive entry: ${relative}`);
    continue;
  }
  const text = readFileSync(absolute, 'utf8');
  checkRetiredPaths(text, relative, 'archive entry');
}
const contextCompatibilityPath = join(root, 'docs/archive/design/CONTEXT.md');
const contextCompatibility = existsSync(contextCompatibilityPath) ? readFileSync(contextCompatibilityPath, 'utf8') : '';
if (!contextCompatibility.includes('](../../../CONTEXT.md)') || !existsSync(resolve(root, 'docs/archive/design/../../../CONTEXT.md'))) {
  errors.push('archive CONTEXT compatibility pointer must resolve to root CONTEXT.md');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`doc governance check passed: ${adrFiles.length} ADRs, ${activeRoots.length} active roots`);
}
