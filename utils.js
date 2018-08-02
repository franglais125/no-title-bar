const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Prefs = Me.imports.prefs;

const appSys = Shell.AppSystem.get_default();

const MAXIMIZED = Meta.MaximizeFlags.BOTH;
const VERTICAL = Meta.MaximizeFlags.VERTICAL;

// global.screen removed in GNOME 3.30
var ws_manager = global.screen ? global.screen : global.workspace_manager;
var display = global.screen ? global.screen : global.display;

let settings = null;

function enable() {
    settings = Convenience.getSettings();
    return settings;
}

function disable() {
    settings.run_dispose();
    settings = null;
}

// Get the window to display the title bar for (buttons etc) or to drag from the top panel
function getWindow(forceSnapped) {
    if (forceSnapped === 'undefined') {
        forceSnapped = false;
    }

    let primaryMonitor = display.get_primary_monitor()
    let onlyPrimaryMonitor = settings.get_boolean('only-main-monitor');
    let includeSnapped = settings.get_boolean('buttons-for-snapped') || forceSnapped;
    let allWindows = settings.get_boolean('buttons-for-all-win');

    // get all window in stacking order.
    let windows = global.display.sort_windows_by_stacking(
        ws_manager.get_active_workspace().list_windows().filter(function (w) {
            return w.get_window_type() !== Meta.WindowType.DESKTOP &&
                (!onlyPrimaryMonitor || w.get_monitor() === primaryMonitor);
        })
    );

    let i = windows.length;
    while (i--) {
        let window = windows[i];
        if (window.minimized || window.is_hidden()) {
            continue;
        }

        let max_state = window.get_maximized();
        if (max_state === MAXIMIZED) {
            return window;
        }

        if (max_state === VERTICAL && includeSnapped) {
            return window;
        }

        if (allWindows) {
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

const IgnoreList = {
    DISABLED: 0,
    WHITELIST: 1,
    BLACKLIST: 2,
}

function getAppInfoOf(window) {
    return getAppList()
        .find(function (appInfo) {
            const app = appSys.lookup_app(appInfo.get_id());
            return app.get_windows().includes(window);
        });
}

function isWindowIgnored(settings, win) {
    const listType = settings.get_enum('ignore-list-type');
    if (listType === IgnoreList.DISABLED) return false;

    let ignoreList = settings.get_string('ignore-list');
    ignoreList = Prefs.splitEntries(ignoreList);

    const appInfo = getAppInfoOf(win);
    if (!appInfo) return false;

    const isAppInList = ignoreList.includes(appInfo.get_name());

    if (listType === IgnoreList.BLACKLIST) {
        return isAppInList;
    } else /* IgnoreList.WHITELIST */ {
        return !isAppInList;
    }
}
