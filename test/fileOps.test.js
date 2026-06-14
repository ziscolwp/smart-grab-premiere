const test = require('node:test');
const assert = require('node:assert');
const fileOps = require('../panel/js/fileOps.js');

test('promoteNoOverwrite retries when the chosen destination appears during promotion', () => {
  const existing = new Set();
  const copied = [];
  const removed = [];
  let firstCopy = true;
  const fs = {
    constants: { COPYFILE_EXCL: 1 },
    existsSync: (p) => existing.has(p),
    copyFileSync: (from, to, flag) => {
      assert.strictEqual(flag, 1);
      if (firstCopy) {
        firstCopy = false;
        existing.add(to);
        const err = new Error('exists');
        err.code = 'EEXIST';
        throw err;
      }
      copied.push([from, to]);
      existing.add(to);
    },
    rmSync: (p) => removed.push(p)
  };

  const finalPath = fileOps.promoteNoOverwrite('/out/Clip.smartgrab-part.mp4', '/out/Clip.mp4', { fs });
  assert.strictEqual(finalPath, '/out/Clip (1).mp4');
  assert.deepStrictEqual(copied, [['/out/Clip.smartgrab-part.mp4', '/out/Clip (1).mp4']]);
  assert.deepStrictEqual(removed, ['/out/Clip.smartgrab-part.mp4']);
});
