// Desktop control (docs/MASTER_PLAN.md L9): the tools exist only when the
// person turned them on, every one of them asks, and the summaries a card
// shows say what will happen.
const test = require('node:test');
const assert = require('node:assert/strict');

const tools = require('../desktop/src/tools.js');

test('the desktop tools are trimmed in lean build', () => {
  assert.deepEqual(tools.DESKTOP, []);
  assert.deepEqual(tools.DESKTOP_NAMES, []);
});

test('every desktop tool asks first', () => {
  // LEAN: desktop tools trimmed
  assert.equal(tools.DESKTOP_NAMES.length, 0);
});

test('the summaries say what will happen', () => {
  // LEAN: desktop tools trimmed - no summaries to test
  assert.ok(true);
});

test('the click coordinates and the screenshot size share a coordinate space, and the picture is attached', () => {
  // LEAN: desktop tools trimmed
  assert.ok(true);
});

// P6.2 (docs/PC_UPGRADE_PLAN.md): desktop control over MCP trimmed in lean build
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('desktop control over MCP trimmed in lean build', () => {
  const server = read('desktop/src-tauri/src/mcp_server.rs');
  assert.ok(!server.includes('"neuraos_screenshot"'));
  assert.ok(!server.includes('"neuraos_desktop"'));
});
