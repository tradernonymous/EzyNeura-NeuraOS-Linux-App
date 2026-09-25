// Persist: typing is one {draft} patch per keystroke, and the chat store is
// rewritten whole and encrypted on every save -- so a keystroke must not mean
// a disk write. persist.js is the debounce between the two, and this pins its
// contract: newest value wins, flush is the promise, and an older queued copy
// can never land after a newer explicit write.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const persist = require('../desktop/src/persist.js');

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a scheduled value is written once, when the typing pauses', async () => {
  const writes = [];
  const saver = persist.createDebouncedWrite({ write: (v) => writes.push(v), delay: 20 });
  saver.schedule('a');
  saver.schedule('ab');
  saver.schedule('abc');
  assert.equal(saver.pending(), true, 'a write is owed');
  assert.deepEqual(writes, [], 'nothing is written while typing continues');
  await tick(40);
  assert.deepEqual(writes, ['abc'], 'the newest value is written, once');
  assert.equal(saver.pending(), false);
});

test('flush writes now, and says whether it had anything to do', async () => {
  const writes = [];
  const saver = persist.createDebouncedWrite({ write: (v) => writes.push(v), delay: 1000 });
  assert.equal(saver.flush(), false, 'nothing owed, nothing written');
  saver.schedule('draft');
  assert.equal(saver.flush(), true, 'the owed value is written');
  assert.deepEqual(writes, ['draft']);
  assert.equal(saver.flush(), false, 'and not written twice');
});

test('an older queued copy never lands after a newer explicit write', async () => {
  // The ChatScreen bug this prevents: typing schedules save(state-with-draft),
  // then a send writes state-with-message at once; if the queued older copy
  // were written when its timer fired, the message would vanish from disk.
  const writes = [];
  const saver = persist.createDebouncedWrite({ write: (v) => writes.push(v), delay: 20 });
  saver.schedule('with-draft');
  saver.writeNow('with-message');
  await tick(40);
  assert.deepEqual(writes, ['with-message'], 'the queued stale copy is dropped, not written later');
  assert.equal(saver.pending(), false);
});

test('cancel forgets what is owed', async () => {
  const writes = [];
  const saver = persist.createDebouncedWrite({ write: (v) => writes.push(v), delay: 10 });
  saver.schedule('x');
  saver.cancel();
  assert.equal(saver.pending(), false);
  await tick(30);
  assert.deepEqual(writes, []);
});

test('delay 0 writes immediately', () => {
  const writes = [];
  const saver = persist.createDebouncedWrite({ write: (v) => writes.push(v), delay: 0 });
  saver.schedule('now');
  assert.deepEqual(writes, ['now']);
});

test('a write needs a write()', () => {
  assert.throws(() => persist.createDebouncedWrite({}), /needs a write/);
});

test('only a draft patch is typing; anything else is an event', () => {
  assert.equal(persist.isTypingPatch({ draft: 'hi' }), true);
  assert.equal(persist.isTypingPatch({ draft: 'hi', messages: [] }), false, 'messages are an event');
  assert.equal(persist.isTypingPatch({ title: 'x' }), false);
  assert.equal(persist.isTypingPatch({}), false, 'an empty patch is nothing');
});

test('the screen wears it: typing patches are debounced, events write now, unload flushes', () => {
  // Shape pins on ChatScreen.tsx: the pure module can be right and the screen
  // can still save per keystroke if nobody wires it.
  const screen = fs.readFileSync(
    path.join(__dirname, '..', 'desktop', 'src', 'screens', 'ChatScreen.tsx'),
    'utf8',
  );
  assert.match(screen, /persistLib\.createDebouncedWrite\(\{ write: \(next: ChatSession\[\]\) => saveSessions\(next\)/);
  assert.match(screen, /if \(persistLib\.isTypingPatch\(patch\)\) typingSaver\.schedule\(next\);/);
  assert.match(screen, /else typingSaver\.writeNow\(next\);/, 'an event drops the older queued copy');
  assert.match(screen, /window\.addEventListener\('beforeunload', flush\)/, 'the window cannot lose an owed write');
  assert.match(screen, /import '\.\.\/persist\.js';/, 'the UMD module is loaded for its side effect');
});
