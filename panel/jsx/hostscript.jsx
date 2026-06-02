/**
 * Smart Grab for Premiere — ExtendScript host (ES3).
 * Returns plain strings. Errors are prefixed with "ERROR:".
 */

function sg_getProjectDir() {
    try {
        if (!app.project) return "ERROR:No project open.";
        var p = app.project.path;
        if (!p || p === "") return "ERROR:Save the project first.";
        var f = new File(p);
        return f.parent.fsName;
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

function sg_findOrCreateBin(binName) {
    function deepSearch(folder) {
        if (folder && folder.name === binName && folder.type === 2) return folder;
        var kids = folder ? folder.children : null;
        if (kids) {
            for (var i = 0; i < kids.numItems; i++) {
                if (kids[i] && kids[i].type === 2) {
                    var found = deepSearch(kids[i]);
                    if (found) return found;
                }
            }
        }
        return null;
    }
    var bin = deepSearch(app.project.rootItem);
    if (!bin) {
        app.project.rootItem.createBin(binName);
        bin = deepSearch(app.project.rootItem);
    }
    return bin;
}

function sg_importToBin(filePath, binName) {
    try {
        if (!app.project) return "ERROR:No project open.";
        var bin = sg_findOrCreateBin(binName);
        if (!bin) return "ERROR:Could not create bin '" + binName + "'.";
        var ok = app.project.importFiles([filePath], true, bin, false);
        return ok ? "OK" : "ERROR:Import returned false.";
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}

function sg_pickFolder() {
    try {
        var f = Folder.selectDialog("Choose a download folder");
        if (!f) return "CANCEL";
        return f.fsName;
    } catch (e) {
        return "ERROR:" + e.toString();
    }
}
