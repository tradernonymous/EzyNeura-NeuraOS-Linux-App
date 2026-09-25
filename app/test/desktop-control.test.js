// Desktop control (docs/MASTER_PLAN.md L9): the tools exist only when the
// person turned them on, every one of them asks, and the summaries a card
// shows say what will happen.
const test = require('node:test');
const assert = require('node:assert/strict');

const tools = require('../desktop/src/tools.js');

test('the desktop tools are offered only with desktop on and a shell', () => {
  const names = (list) => list.map((t) => t.function.name);
  assert.deepEqual(names(tools.DESKTOP), ['screen_capture', 'desktop_click', 'desktop_type', 'desktop_key', 'desktop_scroll']);
  assert.deepEqual(tools.DESKTOP_NAMES, names(tools.DESKTOP));
  const off = names(tools.catalogue({ shell: true }, {}));
  const on = names(tools.catalogue({ shell: true, desktop: true }, {}));
  const noShell = names(tools.catalogue({ desktop: true }, {}));
  for (const name of tools.DESKTOP_NAMES) {
    assert.ok(!off.includes(name), `${name} is not offered with desktop off`);
    assert.ok(on.includes(name), `${name} is offered with desktop on`);
    assert.ok(!noShell.includes(name), `${name} needs the shell`);
  }
});

test('every desktop tool asks first', () => {
  for (const name of tools.DESKTOP_NAMES) {
    assert.ok(tools.needsApproval(name, {}), `${name} asks`);
    assert.ok(tools.ASKS[name], `${name} has a reason`);
  }
});

test('the summaries say what will happen', () => {
  assert.equal(tools.summarise('screen_capture', {}), 'Take a screenshot');
  assert.equal(tools.summarise('desktop_click', { x: 120.7, y: 40, button: 3 }), 'Click at 120, 40 (button 3)');
  assert.equal(tools.summarise('desktop_click', { x: 1, y: 2 }), 'Click at 1, 2');
  assert.equal(tools.summarise('desktop_type', { text: 'hello' }), 'Type “hello”');
  assert.equal(tools.summarise('desktop_key', { key: 'ctrl+s' }), 'Press ctrl+s');
  assert.equal(tools.summarise('desktop_scroll', { steps: -3 }), 'Scroll up 3');
});

test('the click coordinates and the screenshot size share a coordinate space, and the picture is attached', () => {
  const capture = tools.DESKTOP.find((t) => t.function.name === 'screen_capture');
  assert.match(capture.function.description, /attached/);
  assert.match(capture.function.description, /coordinate/);
  const click = tools.DESKTOP.find((t) => t.function.name === 'desktop_click');
  assert.deepEqual(click.function.parameters.required, ['x', 'y']);
});

// P6.2 (docs/PC_UPGRADE_PLAN.md): the same desktop actions over MCP, behind a
// second opt-in the `--mcp` process can read (a marker file, not localStorage).
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('desktop control over MCP is a separate opt-in with its own toggle', () => {
  const card = read('desktop/src/components/DesktopControlCard.tsx');
  assert.match(card, /Also let agents connected over MCP see the screen and act on the desktop/);
  assert.match(card, /desktopMcpSet\(on\)/);
  const bridge = read('desktop/src/bridge.ts');
  assert.match(bridge, /call<\{ on: boolean \}>\('desktop_mcp_set', \{ on \}\)/);
  const server = read('desktop/src-tauri/src/mcp_server.rs');
  assert.match(server, /"neuraos_screenshot"/);
  assert.match(server, /"neuraos_desktop"/);
  assert.match(server, /desktop_allowed\(desktop_mcp_marker\(\)\.is_file\(\)\)\?;/);
  assert.match(server, /"type": "image", "data": png_b64, "mimeType": "image\/png"/);
});
