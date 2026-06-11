// panel/js/settings.js
var fs = require('fs');
var path = require('path');
var os = require('os');

var DIR = process.platform === 'win32'
  ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'SmartGrab')
  : path.join(os.homedir(), 'Library', 'Application Support', 'SmartGrab');
var FILE = path.join(DIR, 'settings.json');

var DEFAULTS = {
  destinationMode: 'sync',                                   // 'sync' | 'custom'
  customFolder: path.join(os.homedir(), 'Downloads', 'yt-grabs'),
  binName: 'Downloaded Video',
  lastQuality: 'fhd',
  lastVideoFormat: 'mp4Premiere',
  lastAudioFormat: 'mp3',
  cookiesBrowser: 'none',                                    // 'none' | 'chrome' | 'firefox' | 'edge' | 'safari' | 'brave'
  trimMode: 'fast'                                           // 'fast' (download only the section) | 'precise' (full download + local trim)
};

function merge(base, over) {
  var out = {};
  var k;
  for (k in base) { if (base.hasOwnProperty(k)) out[k] = base[k]; }
  if (over) { for (k in over) { if (over.hasOwnProperty(k)) out[k] = over[k]; } }
  return out;
}

function load(file) {
  file = file || FILE;
  try {
    return merge(DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    return merge(DEFAULTS, null);
  }
}

function save(obj, file) {
  file = file || FILE;
  try {
    var dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(merge(DEFAULTS, obj), null, 2), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { load: load, save: save, DEFAULTS: DEFAULTS, FILE: FILE, DIR: DIR };
