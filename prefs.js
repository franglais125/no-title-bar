const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
let extensionPath = Me.path;

const Gettext = imports.gettext.domain('no-title-bar');
const _ = Gettext.gettext;

let settings;

function init() {
    settings = Convenience.getSettings(Me);
    Convenience.initTranslations('no-title-bar');
}

function buildPrefsWidget(){

    // Prepare labels and controls
    let buildable = new Gtk.Builder();
    buildable.add_from_file( Me.dir.get_path() + '/Settings.ui' );
    let box = buildable.get_object('prefs_widget');

    // Monitors:
    settings.bind('only-main-monitor',
        buildable.get_object('only_main_monitor_switch'),
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );

    // Buttons:
    buildable.get_object('button_position').set_active(settings.get_enum('button-position'));
    buildable.get_object('button_position').connect('changed', Lang.bind (this, function(widget) {
        settings.set_enum('button-position', widget.get_active());
    }));
    settings.bind('automatic-theme',
        buildable.get_object('automatic_theme_switch'),
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    settings.bind('automatic-theme',
                  buildable.get_object('theme_combobox'),
                  'sensitive',
                  Gio.SettingsBindFlags.INVERT_BOOLEAN);

    let themes_dir = Gio.file_new_for_path(
            GLib.build_filenamev([extensionPath, 'themes'])
        );
    let fileEnum = themes_dir.enumerate_children(
        'standard::*',
        Gio.FileQueryInfoFlags.NONE, null
    );

    let info;
    while ((info = fileEnum.next_file(null)) !== null) {
        let theme = info.get_name();
        if (GLib.file_test(GLib.build_filenamev([themes_dir.get_path(),
                theme, 'style.css']), GLib.FileTest.EXISTS)) {
            buildable.get_object('theme_combobox').append(theme, theme);
        }
    }
    fileEnum.close(null);

    buildable.get_object('theme_combobox').connect(
        'changed',
        Lang.bind(this, function (combo) {
            let value = combo.get_active_id();
            if (value !== undefined &&
                settings.get_string('theme') !== value) {
                settings.set_string('theme', value);
            }
    }));
    buildable.get_object('theme_combobox').set_active_id(settings.get_string('theme') || 'default');

    // App menu:
    settings.bind('change-appmenu',
        buildable.get_object('appmenu_switch'),
        'active',
        Gio.SettingsBindFlags.DEFAULT);

    box.show_all();

    return box;
};

