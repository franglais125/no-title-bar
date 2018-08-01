const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

const display = Utils.display;

let SHOW_DELAY = 350;
let SHOW_DURATION = 0.15;
let HIDE_DURATION = 0.1;

var AppMenu = new Lang.Class({
    Name: 'NoTitleBar.AppMenu',

    _init: function(settings) {
        this._wmCallbackIDs = [];
        this._focusCallbackID = 0;
        this._tooltipCallbackID = 0;
        this._globalCallBackID = 0;
        this._isEnabled = false;

        this._appMenu = Main.panel.statusArea.appMenu;

        this._activeWindow = null;
        this._awCallbackID = 0;

        // Tooltip
        this._tooltip = null;
        this._showTooltip = false;
        this._tooltipIsShown = false;

        this._tooltipDelayCallbackID = 0;
        this._menuCallbackID = 0;

        // Load settings
        this._settings = settings;
        this._settingsId = this._settings.connect('changed::change-appmenu',
            Lang.bind(this, function() {
                if (this._settings.get_boolean('change-appmenu'))
                    this._enable();
                else
                    this._disable();
            }));

        if (this._settings.get_boolean('change-appmenu'))
            this._enable();
        else
            this._disable();
    },

    /**
     * AppMenu synchronization
     */
    _updateAppMenu: function() {
        let win = global.display.focus_window;
        if (!win) {
            return false;
        }

        let title = win.title;

        // Not the topmost maximized window.
        if (win !== Utils.getWindow()) {
            let app = Shell.WindowTracker.get_default().get_window_app(win);
            title = app.get_name();
        }

        // Not on the primary monitor
        if (this._settings.get_boolean('only-main-monitor') && !win.is_on_primary_monitor()) {
            let app = Shell.WindowTracker.get_default().get_window_app(win);
            title = app.get_name();
        }
        this._appMenu._label.set_text(title);
        this._tooltip.text = title;

        return false;
    },

    _updateAppMenuWidth: function() {
        this._restoreAppMenuWidth();

        let width = this._settings.get_int('app-menu-width');
        if (width > -1)
            this._appMenu._label.set_style('max-width: ' + width + 'px');

        this._updateAppMenu();
    },

    _restoreAppMenuWidth: function() {
        this._appMenu._label.set_style('max-width');
    },

    /**
     * Track the focused window's title
     */
    _changeActiveWindow: function (win) {
        if (win === this._activeWindow) {
            return;
        }

        if (this._activeWindow) {
            this._activeWindow.disconnect(this._awCallbackID);
        }

        this._activeWindow = win;

        if (win) {
            this._awCallbackID = win.connect('notify::title', Lang.bind(this, this._updateAppMenu));
            this._updateAppMenu();
        }
    },

    /**
     * Focus change
     */
    _onFocusChange: function() {
        let input_mode_check = (global.stage_input_mode === undefined)
            ? true
            : global.stage_input_mode == Shell.StageInputMode.FOCUSED;
        if (!Shell.WindowTracker.get_default().focus_app && input_mode_check) {
            // If the app has just lost focus to the panel, pretend
            // nothing happened; otherwise you can't keynav to the
            // app menu.
            return false;
        }

        this._changeActiveWindow(global.display.focus_window);
        return false;
    },

    /**
     * tooltip
     */

    _resetMenuCallback: function() {
        if (this._menuCallbackID) {
            this._appMenu.menu.disconnect(this._menuCallbackID);
            this._menuCallbackID = 0;
        }
    },

    _onAppMenuHover: function(actor) {
        let hover = actor.get_hover();
        if (this._showTooltip === hover) {
            return false;
        }

        // We are not in the right state, let's fix that.
        this._showTooltip = hover;

        if (this._showTooltip) {
            this._tooltipDelayCallbackID = Mainloop.timeout_add(SHOW_DELAY, Lang.bind(this, function() {
                // Something wants us to stop.
                if (this._tooltipDelayCallbackID === 0) {
                    return false;
                }

                let label = this._appMenu._label;
                if (!label.get_clutter_text().get_layout().is_ellipsized()) {
                    // Do not need to hide.
                    this._tooltipDelayCallbackID = 0;
                    return false;
                }

                if (!this._tooltipIsShown) {
                    Main.uiGroup.add_actor(this._tooltip);
                    this._tooltipIsShown = true;
                }

                this._resetMenuCallback();
                this._menuCallbackID = this._appMenu.menu.connect('open-state-changed', function(menu, open) {
                    if (!this._tooltip) {
                        return;
                    }

                    if (open && this._tooltipIsShown) {
                        Main.uiGroup.remove_actor(this._tooltip);
                        this._tooltipIsShown = false;
                    } else if (!this._tooltipIsShown) {
                        Main.uiGroup.add_actor(this._tooltip);
                        this._tooltipIsShown = true;
                    }
                });

                let [px, py] = Main.panel.actor.get_transformed_position();
                let [bx, by] = label.get_transformed_position();
                let [w, h] = label.get_transformed_size();

                let y = py + Main.panel.actor.get_height() + 3;
                let x = bx - Math.round((this._tooltip.get_width() - w)/2);
                this._tooltip.opacity = 0;
                this._tooltip.set_position(x, y);

                Tweener.removeTweens(this._tooltip);
                Tweener.addTween(this._tooltip, {
                    opacity: 255,
                    time: SHOW_DURATION,
                    transition: 'easeOutQuad',
                });

                return false;
            }));
        } else if (this._tooltipDelayCallbackID > 0) {
            // If the event ran, then we hide.
            this._resetMenuCallback();

            Tweener.removeTweens(this._tooltip);
            Tweener.addTween(this._tooltip, {
                opacity: 0,
                time: HIDE_DURATION,
                transition: 'easeOutQuad',
                onComplete: Lang.bind(this, function() {
                    if (this._tooltipIsShown) {
                        Main.uiGroup.remove_actor(this._tooltip);
                        this._tooltipIsShown = false;
                    }
                })
            });

            this._tooltipDelayCallbackID = 0;
        }

        return false;
    },

    _enable: function() {
        this._tooltip = new St.Label({
            style_class: 'tooltip dash-label',
            text: '',
            opacity: 0
        });

        this._wmCallbackIDs = this._wmCallbackIDs.concat(Utils.onSizeChange(Lang.bind(this, this._updateAppMenu)));

        this._focusCallbackID = global.display.connect('notify::focus-window', Lang.bind(this, this._onFocusChange));
        this._onFocusChange();

        this._tooltipCallbackID = this._appMenu.actor.connect('notify::hover',
            Lang.bind(this, this._onAppMenuHover));
        this._globalCallBackID = display.connect('restacked',
            Lang.bind(this, this._updateAppMenu));

        this._labelId = this._settings.connect('changed::app-menu-width',
            Lang.bind(this, function() {
                if (this._settings.get_boolean('change-appmenu'))
                    this._updateAppMenuWidth();
            }));
        this._updateAppMenuWidth();

        this._isEnabled = true;
    },

    _disable: function() {
        this._wmCallbackIDs.forEach(function(id) {
            global.window_manager.disconnect(id);
        });

        this._wmCallbackIDs = [];

        if (this._focusCallbackID) {
            global.display.disconnect(this._focusCallbackID);
            this._focusCallbackID = 0;
        }

        if (this._globalCallBackID) {
            display.disconnect(this._globalCallBackID);
            this._globalCallBackID = 0;
        }

        if (this._tooltipCallbackID) {
            this._appMenu.actor.disconnect(this._tooltipCallbackID);
            this._tooltipCallbackID = 0;
        }

        if (this._activeWindow) {
            this._activeWindow.disconnect(this._awCallbackID);
            this._awCallbackID = 0;
            this._activeWindow = null;
        }

        if (this._tooltipDelayCallbackID) {
            Mainloop.source_remove(this._tooltipDelayCallbackID);
            this._tooltipDelayCallbackID = 0;
        }

        this._resetMenuCallback();

        if (this._tooltip) {
            this._tooltip.destroy();
            this._tooltip = null;
        }

        if (this._labelId) {
            this._settings.disconnect(this._labelId);
        }
        this._restoreAppMenuWidth();

        this._isEnabled = false;
    },

    destroy: function() {
         if (this._isEnabled)
             this._disable();

         if (this._settingsId) {
             this._settings.disconnect(this._settingsId);
             this._settingsId = null;
         }
    },
});
