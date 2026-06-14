var fs = require('fs');
var path = require('path');
var settings = require('./settings.js');

var VERSION = 1;
var DEFAULT_FILE = path.join(settings.DIR, 'queue.json');
var WORK_DIR = path.join(settings.DIR, 'work');

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

function safeId(id) {
  return String(id || 'item').replace(/[^a-z0-9_.-]+/ig, '_');
}

function workDirFor(id) {
  return path.join(WORK_DIR, safeId(id));
}

function nextIdSeed(items) {
  var max = 0;
  if (!Array.isArray(items)) return max;
  for (var i = 0; i < items.length; i++) {
    var m = String(items[i] && items[i].id || '').match(/^q(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return max;
}

function managedWorkDir(workDir, root) {
  root = path.resolve(root || WORK_DIR);
  var target = path.resolve(String(workDir || ''));
  return target !== root && target.indexOf(root + path.sep) === 0 ? target : null;
}

function cleanupWorkDir(workDir, root) {
  var target = managedWorkDir(workDir, root);
  if (!target) return false;
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  } catch (e) {
    return false;
  }
}

function cleanupOrphanWorkDirs(items, root) {
  root = path.resolve(root || WORK_DIR);
  var keep = {};
  items = Array.isArray(items) ? items : [];
  for (var i = 0; i < items.length; i++) {
    var target = managedWorkDir(items[i] && items[i].workDir, root);
    if (target) keep[target] = true;
  }
  var removed = [];
  try {
    if (!fs.existsSync(root)) return removed;
    var entries = fs.readdirSync(root, { withFileTypes: true });
    for (var j = 0; j < entries.length; j++) {
      if (!entries[j].isDirectory()) continue;
      var p = path.join(root, entries[j].name);
      if (!keep[path.resolve(p)] && cleanupWorkDir(p, root)) removed.push(p);
    }
  } catch (e) {}
  return removed;
}

module.exports = {
  VERSION: VERSION,
  DEFAULT_FILE: DEFAULT_FILE,
  WORK_DIR: WORK_DIR,
  load: load,
  save: save,
  clear: clear,
  workDirFor: workDirFor,
  nextIdSeed: nextIdSeed,
  cleanupWorkDir: cleanupWorkDir,
  cleanupOrphanWorkDirs: cleanupOrphanWorkDirs
};
