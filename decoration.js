const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;

const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const Config = imports.misc.config;
const Util = imports.misc.util;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

const ws_manager = Utils.ws_manager;
const display = Utils.display;

const IgnoreList = {
    DISABLED:  0,
    WHITELIST: 1,
    BLACKLIST: 2,
}

const WindowState = {
    DEFAULT: 'default',
    HIDE_TITLEBAR: 'hide_titlebar',
    UNDECORATED: 'undecorated',
    UNKNOWN: 'unknown'
}

let appSys = Shell.AppSystem.get_default();
let workspaces = [];

var Decoration = new Lang.Class({
    Name: 'NoTitleBar.Decoration',

    _init: function(settings) {
        this._changeWorkspaceID = 0;
        this._windowEnteredID = 0;
        this._settings = settings;

        // For Gnome Shell < 3.24, we need to unmax and maximize windows again,
        // to redraw the window with no title bar.
        this._forceMaxUnmax = Utils.versionCompare(Config.PACKAGE_VERSION, '3.24') < 0;

        this._enable();

        this._changeMonitorsID = Meta.MonitorManager.get().connect(
            'monitors-changed',
            Lang.bind(this, function() {
                this._disable();
                this._enable();
            })
        );

        this._onlyMainMonitorID = this._settings.connect(
            'changed::only-main-monitor',
            Lang.bind(this, function() {
                this._disable();
                this._enable();
            })
        );

        this._ignoreListID = this._settings.connect(
            'changed::ignore-list',
            Lang.bind(this, function() {
                this._disable();
                this._enable();
            })
        );

        this._ignoreListTypeID = this._settings.connect(
            'changed::ignore-list-type',
            Lang.bind(this, function() {
                this._disable();
                this._enable();
            })
        );
    },

    _enable: function() {
        // Connect events
        this._changeWorkspaceID = ws_manager.connect('notify::n-workspaces', Lang.bind(this, this._onChangeNWorkspaces));
        this._windowEnteredID   = display.connect('window-entered-monitor', Lang.bind(this, this._windowEnteredMonitor));


        // CSS style for Wayland decorations
        this._userStylesPath  = GLib.get_user_config_dir() + '/gtk-3.0/gtk.css';
        Mainloop.idle_add(Lang.bind(this, this._addUserStyles));

        /**
         * Go through already-maximised windows & undecorate.
         * This needs a delay as the window list is not yet loaded
         * when the extension is loaded.
         * Also, connect up the 'window-added' event.
         * Note that we do not connect this before the onMaximise loop
         * because when one restarts the gnome-shell, window-added gets
         * fired for every currently-existing window, and then
         * these windows will have onMaximise called twice on them.
         */
        Mainloop.idle_add(Lang.bind(this, function () {
            this._forEachWindow(Lang.bind(this, function(win) {
                this._onWindowAdded(null, win);
            }));

            this._onChangeNWorkspaces();
            return false;
        }));
    },

    _disable: function() {
        if (this._changeWorkspaceID) {
            ws_manager.disconnect(this._changeWorkspaceID);
            this._changeWorkspaceID = 0;
        }

        if (this._windowEnteredID) {
            display.disconnect(this._windowEnteredID);
            this._windowEnteredID = 0;
        }

        this._cleanWorkspaces();

        this._forEachWindow(Lang.bind(this, function(win) {
            let state = this._getOriginalState(win);
            if (state == WindowState.DEFAULT) {
                this._setHideTitlebar(win, false);
            }

            delete win._noTitleBarOriginalState;
        }));

        // Remove CSS Styles
        this._removeUserStyles();
    },

    destroy: function() {
        this._disable();
        Meta.MonitorManager.get().disconnect(this._changeMonitorsID);
        this._settings.disconnect(this._onlyMainMonitorID);
        this._settings.disconnect(this._ignoreListID);
        this._settings.disconnect(this._ignoreListTypeID);
    },

    /**
     * Guesses the X ID of a window.
     *
     * It is often in the window's title, being `"0x%x %10s".format(XID, window.title)`.
     * (See `mutter/src/core/window-props.c`).
     *
     * If we couldn't find it there, we use `win`'s actor, `win.get_compositor_private()`.
     * The actor's `x-window` property is the X ID of the window *actor*'s frame
     * (as opposed to the window itself).
     *
     * However, the child window of the window actor is the window itself, so by
     * using `xwininfo -children -id [actor's XID]` we can attempt to deduce the
     * window's X ID.
     *
     * It is not always foolproof, but works good enough for now.
     *
     * @param {Meta.Window} win - the window to guess the XID of. You wil get better
     * success if the window's actor (`win.get_compositor_private()`) exists.
     */
    _guessWindowXID: function(win) {
        // We cache the result so we don't need to redetect.
        if (win._noTitleBarWindowID) {
            return win._noTitleBarWindowID;
        }

        /**
         * If window title has non-utf8 characters, get_description() complains
         * "Failed to convert UTF-8 string to JS string: Invalid byte sequence in conversion input",
         * event though get_title() works.
         */
        try {
            let m = win.get_description().match(/0x[0-9a-f]+/);
            if (m && m[0]) {
                return win._noTitleBarWindowID = m[0];
            }
        } catch (err) { }

        // use xwininfo, take first child.
        let act = win.get_compositor_private();
        let xwindow = act && act['x-window'];
        if (xwindow) {
            let xwininfo = GLib.spawn_command_line_sync('xwininfo -children -id 0x%x'.format(xwindow));
            if (xwininfo[0]) {
                let str = xwininfo[1].toString();

                /**
                 * The X ID of the window is the one preceding the target window's title.
                 * This is to handle cases where the window has no frame and so
                 * act['x-window'] is actually the X ID we want, not the child.
                 */
                let regexp = new RegExp('(0x[0-9a-f]+) +"%s"'.format(win.title));
                let m = str.match(regexp);
                if (m && m[1]) {
                    return win._noTitleBarWindowID = m[1];
                }

                // Otherwise, just grab the child and hope for the best
                m = str.split(/child(?:ren)?:/)[1].match(/0x[0-9a-f]+/);
                if (m && m[0]) {
                    return win._noTitleBarWindowID = m[0];
                }
            }
        }

        // Try enumerating all available windows and match the title. Note that this
        // may be necessary if the title contains special characters and `x-window`
        // is not available.
        let result = GLib.spawn_command_line_sync('xprop -root _NET_CLIENT_LIST');
        if (result[0]) {
            let str = result[1].toString();

            // Get the list of window IDs.
            if (str.match(/0x[0-9a-f]+/g) == null)
                return null;
            let windowList = str.match(/0x[0-9a-f]+/g);

            // For each window ID, check if the title matches the desired title.
            for (var i = 0; i < windowList.length; ++i) {
                let cmd = 'xprop -id "' + windowList[i] + '" _NET_WM_NAME _NO_TITLE_BAR_ORIGINAL_STATE';
                let result = GLib.spawn_command_line_sync(cmd);

                if (result[0]) {
                    let output = result[1].toString();
                    let isManaged = output.indexOf("_NO_TITLE_BAR_ORIGINAL_STATE(CARDINAL)") > -1;
                    if (isManaged) {
                        continue;
                    }

                    let title = output.match(/_NET_WM_NAME(\(\w+\))? = "(([^\\"]|\\"|\\\\)*)"/);

                    // Is this our guy?
                    if (title && title[2] == win.title) {
                        return windowList[i];
                    }
                }
            }
        }

        // debugging for when people find bugs..
        return null;
    },

    /**
     * Get the value of _GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED before
     * no-title-bar did its magic.
     *
     * @param {Meta.Window} win - the window to check the property
     */
    _getOriginalState: function (win) {
        if (win._noTitleBarOriginalState !== undefined) {
            return win._noTitleBarOriginalState;
        }

        if (!win.decorated) {
            return win._noTitleBarOriginalState = WindowState.UNDECORATED;
        }

        let id = this._guessWindowXID(win);
        let cmd = 'xprop -id ' + id;

        let xprops = GLib.spawn_command_line_sync(cmd);
        if (!xprops[0]) {
            return win._noTitleBarOriginalState = State.UNKNOWN;
        }

        let str = xprops[1].toString();
        let m = str.match(/^_NO_TITLE_BAR_ORIGINAL_STATE\(CARDINAL\) = ([0-9]+)$/m);
        if (m) {
            let state = !!parseInt(m[1]);
            return win._noTitleBarOriginalState = state
                ? WindowState.HIDE_TITLEBAR
                : WindowState.DEFAULT;
        }

        m = str.match(/^_GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED(\(CARDINAL\))? = ([0-9]+)$/m);
        if (m) {
            let state = !!parseInt(m[2]);
            cmd = ['xprop', '-id', id,
                  '-f', '_NO_TITLE_BAR_ORIGINAL_STATE', '32c',
                  '-set', '_NO_TITLE_BAR_ORIGINAL_STATE',
                  (state ? '0x1' : '0x0')];
            Util.spawn(cmd);
            return win._noTitleBarOriginalState = state
                ? WindowState.HIDE_TITLEBAR
                : WindowState.DEFAULT;
        }

        // GTK uses the _GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED atom to indicate that the
        // title bar should be hidden when maximized. If we can't find this atom, the
        // window uses the default behavior
        return win._noTitleBarOriginalState = WindowState.DEFAULT;
    },

    /**
     * Tells the window manager to hide the titlebar on maximised windows.
     *
     * Does this by setting the _GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED hint - means
     * I can do it once and forget about it, rather than tracking maximize/unmaximize
     * events.
     *
     * **Caveat**: doesn't work with Ubuntu's Ambiance and Radiance window themes -
     * my guess is they don't respect or implement this property.
     *
     * I don't know how to read the inital value, so I'm not sure how to resore it.
     *
     * @param {Meta.Window} win - window to set the HIDE_TITLEBAR_WHEN_MAXIMIZED property of.
     * @param {boolean} hide - whether to hide the titlebar or not.
     */
    _setHideTitlebar: function(win, hide) {
        // Check if the window is a black/white-list
        if (Utils.isWindowIgnored(this._settings, win) && hide) {
            return;
        }

        // Make sure we save the state before altering it.
        this._getOriginalState(win);

        /**
         * Undecorate with xprop. Use _GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED.
         * See (eg) mutter/src/window-props.c
         */
        let winXID = this._guessWindowXID(win);
        if (winXID == null)
            return;
        let cmd = ['xprop', '-id', winXID,
                   '-f', '_GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED', '32c',
                   '-set', '_GTK_HIDE_TITLEBAR_WHEN_MAXIMIZED',
                   (hide ? '0x1' : '0x0')];

        // Run xprop
        let [success, pid] = GLib.spawn_async(
            null,
            cmd,
            null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
            null
        );

        // After xprop completes, unmaximize and remaximize any window
        // that is already maximized. It seems that setting the xprop on
        // a window that is already maximized doesn't actually take
        // effect immediately but it needs a focuse change or other
        // action to force a relayout. Doing unmaximize and maximize
        // here seems to be an uninvasive way to handle this. This needs
        // to happen _after_ xprop completes.
        GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, Lang.bind(this, function () {
            const MAXIMIZED = Meta.MaximizeFlags.BOTH;
            let flags = win.get_maximized();
            if (this._forceMaxUnmax && flags == MAXIMIZED) {
                win.unmaximize(MAXIMIZED);
                win.maximize(MAXIMIZED);
            }
        }));
    },

    /**** Callbacks ****/
    /**
     * Callback when a window is added in any of the workspaces.
     * This includes a window switching to another workspace.
     *
     * If it is a window we already know about, we do nothing.
     *
     * Otherwise, we activate the hide title on maximize feature.
     *
     * @param {Meta.Window} win - the window that was added.
     *
     * @see undecorate
     */
    _onWindowAdded: function(ws, win, retry) {
        if (win.window_type === Meta.WindowType.DESKTOP ||
            win.window_type === Meta.WindowType.MODAL_DIALOG) {
            return false;
        }

        // If the window is simply switching workspaces, it will trigger a
        // window-added signal. We don't want to reprocess it then because we already
        // have.
        if (win._noTitleBarOriginalState !== undefined) {
            return false;
        }

        /**
         * Newly-created windows are added to the workspace before
         * the compositor knows about them: get_compositor_private() is null.
         * Additionally things like .get_maximized() aren't properly done yet.
         * (see workspace.js _doAddWindow)
         */
        if (!win.get_compositor_private()) {
            retry = (retry !== undefined) ? retry : 0;
            if (retry > 3) {
                return false;
            }

            Mainloop.idle_add(Lang.bind(function () {
                this._onWindowAdded(ws, win, retry + 1);
                return false;
            }));
            return false;
        }

        retry = 3;
        Mainloop.idle_add(Lang.bind(this, function () {
            let id = this._guessWindowXID(win);
            if (!id) {
                if (--retry) {
                    return true;
                }

                return false;
            }

            let hide = true;
            if (this._settings.get_boolean('only-main-monitor'))
                hide = win.is_on_primary_monitor();
            this._setHideTitlebar(win, hide);
            return false;
        }));

        return false;
    },

    /**
     * Callback whenever the number of workspaces changes.
     *
     * We ensure that we are listening to the 'window-added' signal on each of
     * the workspaces.
     *
     * @see _onWindowAdded
     */
    _onChangeNWorkspaces: function() {
        this._cleanWorkspaces();

        let i = ws_manager.n_workspaces;
        while (i--) {
            let ws = ws_manager.get_workspace_by_index(i);
            workspaces.push(ws);
            // we need to add a Mainloop.idle_add, or else in _onWindowAdded the
            // window's maximized state is not correct yet.
            ws._noTitleBarWindowAddedId = ws.connect('window-added', Lang.bind(this, function (ws, win) {
                Mainloop.idle_add(Lang.bind(this, function () { return this._onWindowAdded(ws, win); }));
            }));
        }

        return false;
    },

    /* CSS styles, for Wayland decorations
     */

    _updateUserStyles: function () {
        let styleContent = '';

        if (GLib.file_test(this._userStylesPath, GLib.FileTest.EXISTS)) {
            let fileContent = GLib.file_get_contents(this._userStylesPath);

            if (fileContent[0] == true) {
                styleContent = fileContent[1].toString();
                styleContent = styleContent.replace(/@import.*no-title-bar@franglais125\.gmail\.com.*css['"]\);\n/g, '');
            }
        }

        return styleContent;
    },

    _addUserStyles: function () {
        let styleContent = this._updateUserStyles();
        let styleFilePath = Me.path + '/stylesheet.css';
        let styleImport = "@import url('" + styleFilePath + "');\n";

        styleFilePath = Me.path + '/stylesheet-tiled.css';
        styleImport += "@import url('" + styleFilePath + "');\n";

        GLib.file_set_contents(this._userStylesPath, styleImport + styleContent);
    },

    _removeUserStyles: function () {
        let styleContent = this._updateUserStyles();
        GLib.file_set_contents(this._userStylesPath, styleContent);
    },


    /**
     * Utilities
     */
    _cleanWorkspaces: function() {
        // disconnect window-added from workspaces
        workspaces.forEach(function(ws) {
            ws.disconnect(ws._noTitleBarWindowAddedId);
            delete ws._noTitleBarWindowAddedId;
        });

        workspaces = [];
    },

    _forEachWindow: function(callback) {
        global.get_window_actors()
            .map(function (w) { return w.meta_window; })
            .filter(function(w) { return w.window_type !== Meta.WindowType.DESKTOP; })
            .forEach(callback);
    },

    _windowEnteredMonitor: function(metaScreen, monitorIndex, metaWin) {
        let hide = true;
        if (this._settings.get_boolean('only-main-monitor'))
            hide = monitorIndex == Main.layoutManager.primaryIndex;
        this._setHideTitlebar(metaWin, hide);
    }

});
