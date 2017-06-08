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
const Util = Me.imports.util;

function LOG(message) {
	// log("[pixel-saver]: " + message);
}

let showWarning = false;
function WARN(message) {
	log("[pixel-saver]: " + message);
}

/**
 * Buttons
 */
const DCONF_META_PATH = 'org.gnome.desktop.wm.preferences';

let actors = [], boxes = [];

const Buttons = new Lang.Class({
	Name: 'PixelSaver.Buttons',

	_init: function(settings) {
		this.extensionPath = Me.dir.get_path();

		this.wmCallbackIDs = [];
		this.overviewCallbackIDs = [];
		this.themeCallbackID = 0;
		this.globalCallBackID = 0;
		this.settings = settings;
		this.isEnabled = false;
		this.activeCSS = false;

		this.settingsId = this.settings.connect('changed::show-buttons',
			Lang.bind(this, function() {
				if (this.settings.get_boolean('show-buttons'))
					this.enable();
				else
					this.disable();
			}));

		if (this.settings.get_boolean('show-buttons'))
			this.enable();
		else
			this.disable();
	},

	createButtons: function() {
		// Ensure we do not create buttons twice.
		this.destroyButtons();

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
		LOG('Buttons layout : ' + order);

		let orders = order.replace(/ /g, '').split(':');

		orders[0] = orders[0].split(',');

		// Check if it's actually exists, if not then create it
		if(typeof orders[1] == 'undefined') orders[1] = '';
		orders[1] = orders[1].split(',');

		const callbacks = {
			minimize : this.minimize,
			maximize : this.maximize,
			close	: this.close
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

				button.connect('button-release-event', this.leftclick(callbacks[order[i]]));
				box.add(button);
			}
		}

		Mainloop.idle_add(Lang.bind(this, function () {
			// 1 for activity button and -1 for the menu
			if (boxes[0].get_children().length) {
				Main.panel._leftBox.insert_child_at_index(actors[0], 1);
			}

			if (boxes[1].get_children().length) {
				Main.panel._rightBox.insert_child_at_index(actors[1], Main.panel._rightBox.get_children().length - 1);
			}

			this.updateVisibility();
			return false;
		}));
	},

	destroyButtons: function() {
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
	leftclick: function(callback) {
		return function(actor, event) {
			if (event.get_button() !== 1) {
				return null;
			}

			return callback(actor, event);
		}
	},

	minimize: function() {
		let win = Util.getWindow();
		if (!win || win.minimized) {
			if (showWarning)
				WARN('impossible to minimize');
			return;
		}

		win.minimize();
	},

	maximize: function() {
		let win = Util.getWindow();
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

	close: function() {
		let win = Util.getWindow();
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
	loadTheme: function() {
		let theme = Gtk.Settings.get_default().gtk_theme_name,
			cssPath = GLib.build_filenamev([this.extensionPath, 'themes', theme, 'style.css']);

		LOG('Load theme ' + theme);
		if (!GLib.file_test(cssPath, GLib.FileTest.EXISTS)) {
			cssPath = GLib.build_filenamev([this.extensionPath, 'themes/default/style.css']);
		}

		if (cssPath === this.activeCSS) {
			return;
		}

		this.unloadTheme();

		// Load the new style
		let cssFile = Gio.file_new_for_path(cssPath);
		St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(cssFile);

		// Force style update.
		actors.forEach(function(actor) {
			actor.grab_key_focus();
		});

		this.activeCSS = cssPath;
	},

	unloadTheme: function() {
		if (this.activeCSS) {
			LOG('Unload ' + this.activeCSS);

			let cssFile = Gio.file_new_for_path(this.activeCSS);
			St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(cssFile);
			this.activeCSS = false;
		}
	},

	/**
	 * callbacks
	 */
	updateVisibility: function() {
		// If we have a window to control, then we show the buttons.
		let visible = !Main.overview.visible;
		if (visible) {
			visible = false;
			let win = Util.getWindow();
			if (win) {
				visible = win.decorated;
				// If still visible, check if on primary monitor
				if (visible && this.settings.get_boolean('only-main-monitor'))
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

	enable: function() {
		this.loadTheme();
		this.createButtons();

		this.overviewCallbackIDs.push(Main.overview.connect('showing', Lang.bind(this, this.updateVisibility)));
		this.overviewCallbackIDs.push(Main.overview.connect('hidden', Lang.bind(this, this.updateVisibility)));

		let wm = global.window_manager;
		this.wmCallbackIDs.push(wm.connect('switch-workspace', Lang.bind(this, this.updateVisibility)));
		this.wmCallbackIDs.push(wm.connect('map', Lang.bind(this, this.updateVisibility)));
		this.wmCallbackIDs.push(wm.connect('minimize', Lang.bind(this, this.updateVisibility)));
		this.wmCallbackIDs.push(wm.connect('unminimize', Lang.bind(this, this.updateVisibility)));

		this.wmCallbackIDs = this.wmCallbackIDs.concat(Util.onSizeChange(Lang.bind(this, this.updateVisibility)));

		this.themeCallbackID = Gtk.Settings.get_default().connect('notify::gtk-theme-name', Lang.bind(this, this.loadTheme));

		this.globalCallBackID = global.screen.connect('restacked', Lang.bind(this, this.updateVisibility));

		this.isEnabled = true;
	},

	disable: function() {
		this.wmCallbackIDs.forEach(function(id) {
			global.window_manager.disconnect(id);
		});

		this.overviewCallbackIDs.forEach(function(id) {
			Main.overview.disconnect(id);
		});

		this.wmCallbackIDs = [];
		this.overviewCallbackIDs = [];

		if (this.themeCallbackID) {
			Gtk.Settings.get_default().disconnect(this.themeCallbackID);
			this.themeCallbackID = 0;
		}

		if (this.globalCallBackID) {
			global.screen.disconnect(this.globalCallBackID);
			this.globalCallBackID = 0;
		}

		this.destroyButtons();
		this.unloadTheme();

		this.isEnabled = false;
	},

	destroy: function() {
		if (this.isEnabled)
			this.disable();

		if (this.settingsId) {
			this.settings.disconnect(this.settingsId);
			this.settingsId = 0
		}
	}
});
