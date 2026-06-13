var fs = require('fs');
var path = require('path');
var settings = require('./settings.js');

var VERSION = 1;
var DEFAULT_FILE = path.join(settings.DIR, 'queue.json');

function empty() {
  return { version: VERSION, items: [] };
}

function backupCorrupt(file) {
  try {
    if (!fs.existsSync(file)) return;
    var backup = file + '.bad-' + Date.now();
    fs.renameSync(file, backup);
  } catch (e) {}
}

function load(file) {
  file = file || DEFAULT_FILE;
  try {
    if (!fs.existsSync(file)) return empty();
    var parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || !Array.isArray(parsed.items)) return empty();
    return { version: parsed.version || VERSION, items: parsed.items };
  } catch (e) {
    backupCorrupt(file);
    return empty();
  }
}

function save(snapshot, file) {
  file = file || DEFAULT_FILE;
  try {
    var dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var tmp = file + '.tmp';
    var payload = {
      version: VERSION,
      savedAt: Date.now(),
      items: snapshot && Array.isArray(snapshot.items) ? snapshot.items : []
    };
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { fs.rmSync(file + '.tmp', { force: true }); } catch (e2) {}
    return false;
  }
}

function clear(file) {
  file = file || DEFAULT_FILE;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  VERSION: VERSION,
  DEFAULT_FILE: DEFAULT_FILE,
  load: load,
  save: save,
  clear: clear
};
