var fsMod = require('fs');
var L = require('./engineLogic.js');

function promoteNoOverwrite(partialPath, desiredPath, deps) {
  deps = deps || {};
  var fs = deps.fs || fsMod;
  var lastErr = null;
  for (var i = 0; i < 10000; i++) {
    var candidate = L.uniquePath(desiredPath, fs.existsSync);
    try {
      fs.copyFileSync(partialPath, candidate, fs.constants.COPYFILE_EXCL);
      fs.rmSync(partialPath, { force: true });
      return candidate;
    } catch (e) {
      lastErr = e;
      if (!e || e.code !== 'EEXIST') throw e;
    }
  }
  throw lastErr || new Error('Could not reserve output path.');
}

module.exports = {
  promoteNoOverwrite: promoteNoOverwrite
};
