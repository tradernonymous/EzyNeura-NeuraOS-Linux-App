// The rules of hooks, checked on every component at test time.
//
// A hook (useState, useEffect, useFoo...) must be called directly in the body
// of a component or of another hook, never inside a callback, an effect, a
// loop body's function, or at module level. Breaking that is React error #321
// ("invalid hook call") or #310, and it takes the whole window down to the
// crash screen. TypeScript cannot see it (the code is valid), and a render
// test only catches it on the screen that renders it, so this parses every
// source file with the TypeScript compiler and checks where each hook call
// sits. It caught a useEffect nested inside another useEffect's callback in
// LocalImagesCard (HubDownloader), which crashed the app on a real Mint PC.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'desktop', 'src');
const ts = require(path.join(__dirname, '..', 'desktop', 'node_modules', 'typescript'));

const isHookName = (n) => /^use[A-Z0-9]/.test(n);
// A function that may call hooks: a component (Capitalised) or a hook.
const mayCallHooks = (n) => /^[A-Z]/.test(n) || isHookName(n);

function sourceFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(tsx?|jsx?)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** The name a function is known by: its own, its variable's, or memo/forwardRef's variable. */
function functionName(node) {
  if (node.name && node.name.getText) return node.name.getText();
  let parent = node.parent;
  if (parent && ts.isCallExpression(parent) && /^(React\.)?(memo|forwardRef)$/.test(parent.expression.getText())) parent = parent.parent;
  if (parent && ts.isVariableDeclaration(parent)) return parent.name.getText();
  return '';
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

/** Every hook call whose nearest enclosing function is not a component or a hook. */
function misplacedHooks(file) {
  const text = fs.readFileSync(file, 'utf8');
  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const found = [];
  const visit = (node, owner) => {
    let here = owner;
    if (isFunctionLike(node)) here = functionName(node) || '(an anonymous function)';
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText().replace(/^React\./, '');
      if (isHookName(callee) && !(here && mayCallHooks(here))) {
        const { line } = src.getLineAndCharacterOfPosition(node.getStart());
        found.push(`${path.relative(SRC, file)}:${line + 1} calls ${callee}() inside ${here || 'the module'}`);
      }
    }
    ts.forEachChild(node, (child) => visit(child, here));
  };
  visit(src, '');
  return found;
}

test('every hook is called at the top level of a component or a hook', () => {
  const files = sourceFiles(SRC);
  assert.ok(files.length > 50, `${files.length} source files found`);
  const found = files.flatMap(misplacedHooks);
  assert.deepEqual(found, [], 'hooks called outside a component or hook body (React error #321)');
});

test('the checker catches a hook nested in an effect, and passes a correct one', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hooks-'));
  const bad = path.join(tmp, 'Bad.tsx');
  fs.writeFileSync(bad, 'export function Card() {\n  useEffect(() => {\n    useEffect(() => {}, []);\n  }, []);\n  return null;\n}\n');
  const good = path.join(tmp, 'Good.tsx');
  fs.writeFileSync(good, 'export function Card() {\n  useEffect(() => {}, []);\n  useEffect(() => {}, []);\n  const f = () => 1;\n  return f();\n}\nexport function useThing() { return useState(0); }\n');
  const badFound = misplacedHooks(bad);
  assert.equal(badFound.length, 1);
  assert.match(badFound[0], /Bad\.tsx:3 calls useEffect\(\) inside \(an anonymous function\)/);
  assert.deepEqual(misplacedHooks(good), []);
});
