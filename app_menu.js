const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Util = Me.imports.util;

let showLog = false;
function LOG(message) {
    log("[pixel-saver]: " + message);
}

let showWarning = false;
function WARN(message) {
    log("[pixel-saver]: " + message);
}

let SHOW_DELAY = 350;
let SHOW_DURATION = 0.15;
let HIDE_DURATION = 0.1;

const AppMenu = new Lang.Class({
    Name: 'PixelSaver.AppMenu',

    _init: function(settings) {
        this.wmCallbackIDs = [];
        this.focusCallbackID = 0;
        this.tooltipCallbackID = 0;
        this.globalCallBackID = 0;
        this.isEnabled = false;

        this.appMenu = Main.panel.statusArea.appMenu;

        this.activeWindow = null;
        this.awCallbackID = 0;

        // Tooltip
        this.tooltip = null;
        this.showTooltip = false;

        this.tooltipDelayCallbackID = 0;
        this.menuCallbackID = 0;

        // Load settings
        this.settings = settings;
        this.settingsId = this.settings.connect('changed::change-appmenu',
            Lang.bind(this, function() {
                if (this.settings.get_boolean('change-appmenu'))
                    this.enable();
                else
                    this.disable();
            }));

        if (this.settings.get_boolean('change-appmenu'))
            this.enable();
        else
            this.disable();
    },

    /**
     * AppMenu synchronization
     */
    updateAppMenu: function() {
        let win = global.display.focus_window;
        if (!win) {
            return false;
        }

        let title = win.title;

        // Not the topmost maximized window.
        if (win !== Util.getWindow()) {
            let app = Shell.WindowTracker.get_default().get_window_app(win);
            title = app.get_name();
        }

        // Not on the primary monitor
        if (this.settings.get_boolean('only-main-monitor') && !win.is_on_primary_monitor()) {
            let app = Shell.WindowTracker.get_default().get_window_app(win);
            title = app.get_name();
        }
        if (showLog)
            LOG('Override title ' + title);
        this.appMenu._label.set_text(title);
        this.tooltip.text = title;

        return false;
    },

    /**
     * Track the focused window's title
     */
    changeActiveWindow: function (win) {
        if (win === this.activeWindow) {
            return;
        }

        if (this.activeWindow) {
            this.activeWindow.disconnect(this.awCallbackID);
        }

        this.activeWindow = win;

        if (win) {
            this.awCallbackID = win.connect('notify::title', Lang.bind(this, this.updateAppMenu));
            this.updateAppMenu();
        }
    },

    /**
     * Focus change
     */
    onFocusChange: function() {
        let input_mode_check = (global.stage_input_mode === undefined)
            ? true
            : global.stage_input_mode == Shell.StageInputMode.FOCUSED;
        if (!Shell.WindowTracker.get_default().focus_app && input_mode_check) {
            // If the app has just lost focus to the panel, pretend
            // nothing happened; otherwise you can't keynav to the
            // app menu.
            return false;
        }

        this.changeActiveWindow(global.display.focus_window);
        return false;
    },

    /**
     * tooltip
     */

    resetMenuCallback: function() {
        if (this.menuCallbackID) {
            this.appMenu.menu.disconnect(this.menuCallbackID);
            this.menuCallbackID = 0;
        }
    },

    onAppMenuHover: function(actor) {
        let hover = actor.get_hover();
        if (this.showTooltip === hover) {
            return false;
        }

        // We are not in the right state, let's fix that.
        this.showTooltip = hover;

        if (this.showTooltip) {
            this.tooltipDelayCallbackID = Mainloop.timeout_add(SHOW_DELAY, Lang.bind(this, function() {
                if (showWarning && !this.showTooltip) {
                    WARN('showTooltip is false and delay callback ran.');
                }

                // Something wants us to stop.
                if (this.tooltipDelayCallbackID === 0) {
                    return false;
                }

                let label = this.appMenu._label;
                if (!label.get_clutter_text().get_layout().is_ellipsized()) {
                    // Do not need to hide.
                    this.tooltipDelayCallbackID = 0;
                    return false;
                }

                Main.uiGroup.add_actor(this.tooltip);

                this.resetMenuCallback();
                this.menuCallbackID = this.appMenu.menu.connect('open-state-changed', function(menu, open) {
                    if (open) {
                        Main.uiGroup.remove_actor(this.tooltip);
                    } else {
                        Main.uiGroup.add_actor(this.tooltip);
                    }
                });

                [px, py] = Main.panel.actor.get_transformed_position();
                [bx, by] = label.get_transformed_position();
                [w, h] = label.get_transformed_size();

                let y = py + Main.panel.actor.get_height() + 3;
                let x = bx - Math.round((this.tooltip.get_width() - w)/2);
                this.tooltip.opacity = 0;
                this.tooltip.set_position(x, y);

                if (showLog)
                    LOG('show title tooltip');

                Tweener.removeTweens(this.tooltip);
                Tweener.addTween(this.tooltip, {
                    opacity: 255,
                    time: SHOW_DURATION,
                    transition: 'easeOutQuad',
                });

                return false;
            }));
        } else if (this.tooltipDelayCallbackID > 0) {
            // If the event ran, then we hide.
            if (showLog)
                LOG('hide title tooltip');

            this.resetMenuCallback();

            Tweener.removeTweens(this.tooltip);
            Tweener.addTween(this.tooltip, {
                opacity: 0,
                time: HIDE_DURATION,
                transition: 'easeOutQuad',
                onComplete: Lang.bind(this, function() {
                    Main.uiGroup.remove_actor(this.tooltip);
                })
            });

            this.tooltipDelayCallbackID = 0;
        }

        return false;
    },

    enable: function() {
        this.tooltip = new St.Label({
            style_class: 'tooltip dash-label',
            text: '',
            opacity: 0
        });

        this.wmCallbackIDs = this.wmCallbackIDs.concat(Util.onSizeChange(Lang.bind(this, this.updateAppMenu)));

        this.focusCallbackID = global.display.connect('notify::focus-window', Lang.bind(this, this.onFocusChange));
        this.tooltipCallbackID = this.appMenu.actor.connect('notify::hover',
            Lang.bind(this, this.onAppMenuHover));
        this.globalCallBackID = global.screen.connect('restacked',
            Lang.bind(this, this.updateAppMenu));

        this.isEnabled = true;
    },

    disable: function() {
        this.wmCallbackIDs.forEach(function(id) {
            global.window_manager.disconnect(id);
        });

        this.wmCallbackIDs = [];

        if (this.focusCallbackID) {
            global.display.disconnect(this.focusCallbackID);
            this.focusCallbackID = 0;
        }

        if (this.globalCallBackID) {
            global.screen.disconnect(this.globalCallBackID);
            this.globalCallBackID = 0;
        }

        if (this.tooltipCallbackID) {
            this.appMenu.actor.disconnect(this.tooltipCallbackID);
            this.tooltipCallbackID = 0;
        }

        if (this.activeWindow) {
            this.activeWindow.disconnect(this.awCallbackID);
            this.awCallbackID = 0;
            this.activeWindow = null;
        }

        if (this.tooltipDelayCallbackID) {
            Mainloop.source_remove(this.tooltipDelayCallbackID);
            this.tooltipDelayCallbackID = 0;
        }

        this.resetMenuCallback();

        if (this.tooltip) {
            this.tooltip.destroy();
            this.tooltip = null;
        }

        this.isEnabled = false;
    },

    destroy: function() {
         if (this.isEnabled)
             this.disable();

         if (this.settingsId) {
             this.settings.disconnect(this.settingsId);
             this.settingsId = null;
         }
    },
});
