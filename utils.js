const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;

const MAXIMIZED = Meta.MaximizeFlags.BOTH;
const VERTICAL = Meta.MaximizeFlags.VERTICAL;

function getWindow(includeSnapped) {
    // get all window in stacking order.
    let windows = global.display.sort_windows_by_stacking(
        global.screen.get_active_workspace().list_windows().filter(function (w) {
            return w.get_window_type() !== Meta.WindowType.DESKTOP;
        })
    );

    let i = windows.length;
    while (i--) {
        let window = windows[i];
        if (window.minimized) {
            continue;
        }

        let max_state = window.get_maximized();
        if (max_state === MAXIMIZED) {
            return window;
        }

        if (max_state === VERTICAL && includeSnapped) {
            return window;
        }
    }

    return null;
}

function onSizeChange(callback) {
    let callbackIDs = [];
    let wm = global.window_manager;

    // Obvious size change callback.
    callbackIDs.push(wm.connect('size-change', callback));

    // Needed for window drag to top panel (this doesn't trigger maximize).
    callbackIDs.push(wm.connect('hide-tile-preview', callback));

    // NB: 'destroy' needs a delay for .list_windows() report correctly
    callbackIDs.push(wm.connect('destroy', function () {
        Mainloop.idle_add(callback);
    }));

    return callbackIDs;
}

/** Compare two dotted version strings (like '10.2.3').
 * @returns {Integer} 0: v1 == v2, -1: v1 < v2, 1: v1 > v2.
 * Borrowed from system-monitor, https://github.com/paradoxxxzero/gnome-shell-system-monitor-applet
 */
function versionCompare(v1, v2) {
    let v1parts = ('' + v1).split('.')
    let v2parts = ('' + v2).split('.')
    let minLength = Math.min(v1parts.length, v2parts.length)
    let i, p1, p2;
    // Compare tuple pair-by-pair.
    for (i = 0; i < minLength; i++) {
        // Convert to integer if possible, because "8" > "10".
        p1 = parseInt(v1parts[i], 10);
        p2 = parseInt(v2parts[i], 10);
        if (isNaN(p1)) {
            p1 = v1parts[i];
        }
        if (isNaN(p2)) {
            p2 = v2parts[i];
        }
        if (p1 === p2) {
            continue;
        } else if (p1 > p2) {
            return 1;
        } else if (p1 < p2) {
            return -1;
        }
        // one operand is NaN
        return NaN;
    }
    // The longer tuple is always considered 'greater'
    if (v1parts.length === v2parts.length) {
        return 0;
    }
    return (v1parts.length < v2parts.length) ? -1 : 1;
}

function getAppList() {
    let apps = Gio.AppInfo.get_all().filter(function(appInfo) {
        try {
            let id = appInfo.get_name(); // catch invalid file encodings
        } catch(e) {
            return false;
        }
        return appInfo.should_show();
    });

    return apps;
}
