const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Utils = Me.imports.utils;

const display = Utils.display;

const Position = {
    BEFORE_NAME:        0,
    AFTER_NAME:         1,
    WITHIN_STATUS_AREA: 2,
    BEFORE_STATUS_AREA: 3,
    AFTER_STATUS_AREA:  4,
    HIDDEN:             5
}

// Functions for changing opacity (to act as auto-hiding)
function b_hidden(box) {
  Tweener.addTween(box,
                   { opacity: 0,
                     time: 1/6,
                     transition: 'linear'});
}

function b_shown(box) {
  Tweener.addTween(box,
                   { opacity: 255,
                     time: 1/6,
                     transition: 'linear'});
}

/**
 * Buttons
 */
const DCONF_META_PATH = 'org.gnome.desktop.wm.preferences';

let actors = [], boxes = [];

var Buttons = new Lang.Class({
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

        this._settingsId = this._settings.connect(
            'changed::button-position',
            Lang.bind(this, function() {
                this._disable();
                if (this._settings.get_enum('button-position') !== Position.HIDDEN)
                    this._enable();
            })
        );

        this._buttonsForAllWinId = this._settings.connect(
            'changed::buttons-for-all-win',
            Lang.bind(this, function() {
                this._updateVisibility();
            })
        );

        this._snappedId = this._settings.connect(
            'changed::buttons-for-snapped',
            Lang.bind(this, function() {
                this._updateVisibility();
            })
        );

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

        // Adding buttons into a "container"
        this._container = new St.BoxLayout({track_hover: true, reactive: true});
        this._container.add_actor(actors[1]);
        // Enable/disable "autohide" function when switch is changed from settings
        this._settings.connect(
            'changed::hide-buttons',
            Lang.bind(this, function() {
                if (this._settings.get_boolean('hide-buttons')) {
                    this._enableButtonAutohide();
                } else {
                    this._disableButtonAutohide();
                }
            })
        );

        if (this._settings.get_boolean('hide-buttons')) {
            this._enableButtonAutohide();
        } else {
            this._disableButtonAutohide();
        }

        let order = new Gio.Settings({schema_id: DCONF_META_PATH}).get_string('button-layout');
        let orders = order.replace(/ /g, '').split(':');

        orders[0] = orders[0].split(',');

        // Check if it's actually exists, if not then create it
        if(typeof orders[1] == 'undefined') orders[1] = '';
        orders[1] = orders[1].split(',');

        const callbacks = {
            minimize : Lang.bind(this, this._minimize),
            maximize : Lang.bind(this, this._maximize),
            close    : Lang.bind(this, this._close)
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
                        leftBox.insert_child_above(this._container, activitiesBox);
                        break;
                    }
                    case Position.AFTER_NAME: {
                        let appMenuBox = Main.panel.statusArea.appMenu.actor.get_parent()
                        let leftBox = appMenuBox.get_parent();
                        leftBox.insert_child_above(this._container, appMenuBox);
                        break;
                    }
                    case Position.BEFORE_STATUS_AREA:
                        Main.panel._rightBox.insert_child_at_index(this._container, 0);
                        break;
                    case Position.WITHIN_STATUS_AREA:
                        Main.panel._rightBox.insert_child_at_index(this._container, Main.panel._rightBox.get_children().length - 1);
                        break;
                    case Position.AFTER_STATUS_AREA:
                        Main.panel._rightBox.add(this._container);
                        break;
                }
            }

            this._updateVisibility();
            return false;
        }));
    },

    _destroyButtons: function() {
        if (actors) {
            actors.forEach(function(actor, i) {
                actor.destroy();
            });
        }

        actors = [];
        boxes = [];

        if (this._container) {
            this._disableButtonAutohide();
            this._container.destroy();
        }
    },

    _enableButtonAutohide: function() {
        this._disableButtonAutohide();

        if (this._container) {
            this._container.opacity = 0;
        }

        this._containerEnterId = this._container.connect('enter-event', b_shown);
        this._containerLeaveId = this._container.connect('leave-event', b_hidden);
    },

    _disableButtonAutohide: function() {
        if (this._container) {
            this._container.opacity = 255;
        }

        if (this._containerEnterId) {
            this._container.disconnect(this._containerEnterId);
            this._containerEnterId = 0;
        }
        if (this._containerLeaveId) {
            this._container.disconnect(this._containerLeaveId);
            this._containerLeaveId = 0;
        }
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
            return;
        }

        win.minimize();
    },

    _maximize: function() {
        let win = Utils.getWindow();
        if (!win) {
            return;
        }

        const MAXIMIZED = Meta.MaximizeFlags.BOTH;
        if (win.get_maximized() === MAXIMIZED) {
            win.unmaximize(MAXIMIZED);
        } else {
            win.maximize(MAXIMIZED);
        }

        win.activate(global.get_current_time());
    },

    _close: function() {
        let win = Utils.getWindow();
        if (!win) {
            return;
        }

        win.delete(global.get_current_time());
    },

    /**
     * Theming
     */
    _loadTheme: function() {
        let theme;
        if (this._settings.get_boolean('automatic-theme')) {
            theme = Gtk.Settings.get_default().gtk_theme_name;
        } else {
            theme = this._settings.get_string('theme');
        }

        let cssPath = GLib.build_filenamev([this._extensionPath, 'themes', theme, 'style.css']);

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
                visible = win.decorated || this._settings.get_boolean('buttons-for-all-win');

                if (visible) {
                    visible = !Utils.isWindowIgnored(this._settings, win);

                    // If still visible, check if on primary monitor
                    if (visible && this._settings.get_boolean('only-main-monitor')) {
                        visible = win.is_on_primary_monitor();
                    }
                }
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
    _enableDragOnPanel: function() {
        let settings = this._settings;

        this._originalFunction = Main.panel._onButtonPress;

        Main.panel._onButtonPress = function(actor, event) {
            if (Main.modalCount > 0)
                return Clutter.EVENT_PROPAGATE;

            if (event.get_source() != actor)
                return Clutter.EVENT_PROPAGATE;

            let button = event.get_button();
            if (button != 1)
                return Clutter.EVENT_PROPAGATE;

            let forceSnapped = true;
            let focusWindow = Utils.getWindow(forceSnapped);
            if (!focusWindow)
                return Clutter.EVENT_PROPAGATE;

            let dragWindow = focusWindow.is_attached_dialog() ? focusWindow.get_transient_for()
                                                              : focusWindow;
            if (!dragWindow)
                return Clutter.EVENT_PROPAGATE;

            let rect = dragWindow.get_frame_rect();
            let [stageX, stageY] = event.get_coords();

            let allowDrag = dragWindow.maximized_vertically &&
                            stageX > rect.x && stageX < rect.x + rect.width;

            if (!allowDrag)
                return Clutter.EVENT_PROPAGATE;

            global.display.begin_grab_op(display,
                                         dragWindow,
                                         Meta.GrabOp.MOVING,
                                         false, /* pointer grab */
                                         true, /* frame action */
                                         button,
                                         event.get_state(),
                                         event.get_time(),
                                         stageX, stageY);

            return Clutter.EVENT_STOP;
        };

        Main.panel.actor.connect('button-press-event', Lang.bind(Main.panel, Main.panel._onButtonPress));
    },
    _disableDragOnPanel: function() {
        if (!this._originalFunction) {
            return;
        }

        Main.panel._onButtonPress = this._originalFunction;
        Main.panel.actor.connect('button-press-event', Lang.bind(Main.panel, Main.panel._onButtonPress));
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

        this._globalCallBackID = display.connect('restacked', Lang.bind(this, this._updateVisibility));

        this._enableDragOnPanel();

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
            display.disconnect(this._globalCallBackID);
            this._globalCallBackID = 0;
        }

        this._destroyButtons();
        this._unloadTheme();

        this._disableDragOnPanel();

        this._isEnabled = false;
    },

    destroy: function() {
        if (this._isEnabled)
            this._disable();

        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0
        }

        if (this._buttonsForAllWinId) {
            this._settings.disconnect(this._buttonsForAllWinId);
            this._buttonsForAllWinId = 0;
        }

        if (this._snappedId) {
            this._settings.disconnect(this._snappedId);
            this._snappedId = 0;
        }
    }
});
