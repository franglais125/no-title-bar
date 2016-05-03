const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const St = imports.gi.St;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Utils = Me.imports.utils;

let showLog = false;

const Position = {
    BEFORE_NAME:        0,
    AFTER_NAME:         1,
    WITHIN_STATUS_AREA: 2,
    AFTER_STATUS_AREA:  3,
    HIDDEN:             4
}

function LOG(message) {
    log("[no-title-bar]: " + message);
}

let showWarning = false;
function WARN(message) {
    log("[no-title-bar]: " + message);
}

/**
 * Buttons
 */
const DCONF_META_PATH = 'org.gnome.desktop.wm.preferences';

let actors = [], boxes = [];

const Buttons = new Lang.Class({
    Name: 'NoTitleBar.Buttons',

    _init: function(settings) {
        this._extensionPath = Me.dir.get_path();

        this._wmCallbackIDs = [];
        this._overviewCallbackIDs = [];
        this._themeCallbackID = 0;
        this._globalCallBackID = 0;
        this._settings = settings;
        this._isEnabled = false;
        this._activeCSS = false;

        this._settingsId = this._settings.connect('changed::button-position',
            Lang.bind(this, function() {
                this._disable();

                if (this._settings.get_enum('button-position') !== Position.HIDDEN)
                    this._enable();
            }));

        if (this._settings.get_enum('button-position') !== Position.HIDDEN)
            this._enable();
        else
            this._disable();
    },

    _createButtons: function() {
        // Ensure we do not create buttons twice.
        this._destroyButtons();

        actors = [
            new St.Bin({ style_class: 'box-bin'}),
            new St.Bin({ style_class: 'box-bin'})
        ];

        boxes = [
            new St.BoxLayout({ style_class: 'button-box' }),
            new St.BoxLayout({ style_class: 'button-box' })
        ];

        actors.forEach(function(actor, i) {
            actor.add_actor(boxes[i]);
        });

        let order = new Gio.Settings({schema_id: DCONF_META_PATH}).get_string('button-layout');
        if (showLog)
            LOG('Buttons layout : ' + order);

        let orders = order.replace(/ /g, '').split(':');

        orders[0] = orders[0].split(',');

        // Check if it's actually exists, if not then create it
        if(typeof orders[1] == 'undefined') orders[1] = '';
        orders[1] = orders[1].split(',');

        const callbacks = {
            minimize : this._minimize,
            maximize : this._maximize,
            close    : this._close
        };

        for (let bi = 0; bi < boxes.length; ++bi) {
            let order = orders[bi],
                box = boxes[bi];

            for (let i = 0; i < order.length; ++i) {
                if (!order[i]) {
                    continue;
                }

                if (!callbacks[order[i]]) {
                    // Skip if the button's name is not right...
                    if (showWarning)
                        WARN("\'%s\' is not a valid button.".format(order[i]));
                    continue;
                }

                let button = new St.Button({
                    style_class: order[i]  + ' window-button',
                    track_hover: true
                });

                button.connect('button-release-event', this._leftclick(callbacks[order[i]]));
                box.add(button);
            }
        }

        Mainloop.idle_add(Lang.bind(this, function () {
            // 1 for activity button and -1 for the menu
            if (boxes[0].get_children().length) {
                Main.panel._leftBox.insert_child_at_index(actors[0], 1);
            }

            if (boxes[1].get_children().length) {
                switch (this._settings.get_enum('button-position')) {
                    case Position.BEFORE_NAME: {
                        let activitiesBox = Main.panel.statusArea.activities.actor.get_parent()
                        let leftBox = activitiesBox.get_parent();
                        leftBox.insert_child_above(actors[1], activitiesBox);
                        break;
                    }
                    case Position.AFTER_NAME: {
                        let appMenuBox = Main.panel.statusArea.appMenu.actor.get_parent()
                        let leftBox = appMenuBox.get_parent();
                        leftBox.insert_child_above(actors[1], appMenuBox);
                        break;
                    }
                    case Position.WITHIN_STATUS_AREA:
                        Main.panel._rightBox.insert_child_at_index(actors[1], Main.panel._rightBox.get_children().length - 1);
                        break;
                    case Position.AFTER_STATUS_AREA:
                        Main.panel._rightBox.add(actors[1]);
                        break;
                }
            }

            this._updateVisibility();
            return false;
        }));
    },

    _destroyButtons: function() {
        actors.forEach(function(actor, i) {
            actor.destroy();
            boxes[i].destroy();
        });

        actors = [];
        boxes = [];
    },

    /**
     * Buttons actions
     */
    _leftclick: function(callback) {
        return function(actor, event) {
            if (event.get_button() !== 1) {
                return null;
            }

            return callback(actor, event);
        }
    },

    _minimize: function() {
        let win = Utils.getWindow();
        if (!win || win.minimized) {
            if (showWarning)
                WARN('impossible to minimize');
            return;
        }

        win.minimize();
    },

    _maximize: function() {
        let win = Utils.getWindow();
        if (!win) {
            if (showWarning)
                WARN('impossible to maximize');
            return;
        }

        const MAXIMIZED = Meta.MaximizeFlags.BOTH;
        if (win.get_maximized() === MAXIMIZED) {
            win.unmaximize(MAXIMIZED);
        } else {
            if (showWarning)
                WARN('window shoud already be maximized');
            win.maximize(MAXIMIZED);
        }

        win.activate(global.get_current_time());
    },

    _close: function() {
        let win = Utils.getWindow();
        if (!win) {
            if (showWarning)
                WARN('impossible to close');
            return;
        }

        win.delete(global.get_current_time());
    },

    /**
     * Theming
     */
    _loadTheme: function() {
        let theme = Gtk.Settings.get_default().gtk_theme_name,
            cssPath = GLib.build_filenamev([this._extensionPath, 'themes', theme, 'style.css']);

        if (showLog)
            LOG('Load theme ' + theme);
        if (!GLib.file_test(cssPath, GLib.FileTest.EXISTS)) {
            cssPath = GLib.build_filenamev([this._extensionPath, 'themes/default/style.css']);
        }

        if (cssPath === this._activeCSS) {
            return;
        }

        this._unloadTheme();

        // Load the new style
        let cssFile = Gio.file_new_for_path(cssPath);
        St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(cssFile);

        // Force style update.
        actors.forEach(function(actor) {
            actor.grab_key_focus();
        });

        this._activeCSS = cssPath;
    },

    _unloadTheme: function() {
        if (this._activeCSS) {
            if (showLog)
                LOG('Unload ' + this._activeCSS);

            let cssFile = Gio.file_new_for_path(this._activeCSS);
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(cssFile);
            this._activeCSS = false;
        }
    },

    /**
     * callbacks
     */
    _updateVisibility: function() {
        // If we have a window to control, then we show the buttons.
        let visible = !Main.overview.visible;
        if (visible) {
            visible = false;
            let win = Utils.getWindow();
            if (win) {
                visible = win.decorated;
                // If still visible, check if on primary monitor
                if (visible && this._settings.get_boolean('only-main-monitor'))
                    visible = win.is_on_primary_monitor();
            }
        }

        actors.forEach(function(actor, i) {
            if (!boxes[i].get_children().length) {
                return;
            }

            if (visible) {
                actor.show();
            } else {
                actor.hide();
            }
        });

        return false;
    },

    _enable: function() {
        this._loadTheme();
        this._createButtons();

        this._overviewCallbackIDs.push(Main.overview.connect('showing', Lang.bind(this, this._updateVisibility)));
        this._overviewCallbackIDs.push(Main.overview.connect('hidden', Lang.bind(this, this._updateVisibility)));

        let wm = global.window_manager;
        this._wmCallbackIDs.push(wm.connect('switch-workspace', Lang.bind(this, this._updateVisibility)));
        this._wmCallbackIDs.push(wm.connect('map', Lang.bind(this, this._updateVisibility)));
        this._wmCallbackIDs.push(wm.connect('minimize', Lang.bind(this, this._updateVisibility)));
        this._wmCallbackIDs.push(wm.connect('unminimize', Lang.bind(this, this._updateVisibility)));

        this._wmCallbackIDs = this._wmCallbackIDs.concat(Utils.onSizeChange(Lang.bind(this, this._updateVisibility)));

        this._themeCallbackID = Gtk.Settings.get_default().connect('notify::gtk-theme-name', Lang.bind(this, this._loadTheme));

        this._globalCallBackID = global.screen.connect('restacked', Lang.bind(this, this._updateVisibility));

        this._isEnabled = true;
    },

    _disable: function() {
        this._wmCallbackIDs.forEach(function(id) {
            global.window_manager.disconnect(id);
        });

        this._overviewCallbackIDs.forEach(function(id) {
            Main.overview.disconnect(id);
        });

        this._wmCallbackIDs = [];
        this._overviewCallbackIDs = [];

        if (this._themeCallbackID) {
            Gtk.Settings.get_default().disconnect(this._themeCallbackID);
            this._themeCallbackID = 0;
        }

        if (this._globalCallBackID) {
            global.screen.disconnect(this._globalCallBackID);
            this._globalCallBackID = 0;
        }

        this._destroyButtons();
        this._unloadTheme();

        this._isEnabled = false;
    },

    destroy: function() {
        if (this._isEnabled)
            this._disable();

        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0
        }
    }
});
