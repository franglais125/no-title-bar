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

    // Autohide button
    settings.bind('hide-buttons',
        buildable.get_object('hide_buttons_switch'),
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );

    settings.bind('buttons-for-all-win',
        buildable.get_object('buttons_for_all_win_switch'),
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );

    settings.bind('buttons-for-snapped',
        buildable.get_object('snapped_buttons_switch'),
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );

    // Buttons:
    buildable.get_object('button_position').set_active(settings.get_enum('button-position'));
    buildable.get_object('button_position').connect('changed', Lang.bind (this, function(widget) {
        settings.set_enum('button-position', widget.get_active());
    }));

    // App menu:
    settings.bind('change-appmenu',
        buildable.get_object('appmenu_switch'),
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    settings.bind('title-for-snapped',
        buildable.get_object('snapped_appmenu_switch'),
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    settings.bind('app-menu-width',
                        buildable.get_object('label_width_spinbutton'),
                        'value',
                        Gio.SettingsBindFlags.DEFAULT);

    settings.bind('change-appmenu',
                  buildable.get_object('snapped_appmenu_switch'),
                  'sensitive',
                  Gio.SettingsBindFlags.DEFAULT);
    settings.bind('change-appmenu',
                  buildable.get_object('label_width_spinbutton'),
                  'sensitive',
                  Gio.SettingsBindFlags.DEFAULT);

    /*
     * Theme tab:
     * */
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

    /*
     * Ignore list tab:
     * */
    // Set up the List of packages
    buildable.get_object('ignore_list_type').set_active(settings.get_enum('ignore-list-type'));
    buildable.get_object('ignore_list_type').connect('changed', Lang.bind (this, function(widget) {
        settings.set_enum('ignore-list-type', widget.get_active());
    }));

    let column = new Gtk.TreeViewColumn();
    column.set_title(_('Application'));
    buildable.get_object('ignore_list_treeview').append_column(column);

    let renderer = new Gtk.CellRendererText();
    column.pack_start(renderer, null);

    column.set_cell_data_func(renderer, function() {
        arguments[1].markup = arguments[2].get_value(arguments[3], 0);
    });

    let listStore = buildable.get_object('ignore_list_store');
    let treeview  = buildable.get_object('ignore_list_treeview');
    refreshUI(listStore, treeview, settings);
    settings.connect(
        'changed::ignore-list',
        function() {refreshUI(listStore, treeview, settings);}
    );

    buildable.get_object('treeview_selection').connect(
        'changed',
        function(selection) {selectionChanged(selection, listStore);}
    );

    // Toolbar
    let needsList = true;
    buildable.get_object('ignore_list_toolbutton_add').connect(
        'clicked',
        function() {
            let dialog = new Gtk.Dialog({ title: _('Add entry to list'),
                                          transient_for: box.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            let sub_box = buildable.get_object('ignore_list_add_dialog');
            dialog.get_content_area().add(sub_box);

            // Objects
            let addCombobox = buildable.get_object('add_combobox');
            if (needsList) {
                needsList = false;
                let appList = getAppList().map(function(appInfo) {
                    return appInfo.get_name();
                });
                appList.sort();
                appList.forEach(function(appInfo) {
                    addCombobox.append(appInfo, appInfo);
                });
            }
            let saveButton = buildable.get_object('ignore_list_add_button_save');
            let cancelButton = buildable.get_object('ignore_list_add_button_cancel');

            let saveButtonId = saveButton.connect(
                'clicked',
                function() {
                    let value = addCombobox.get_active_id();
                    let name = value;
                    let entries = settings.get_string('ignore-list');

                    if (entries.length > 0)
                        entries = entries + '; ' + name;
                    else
                        entries = name;

                    // Split, order alphabetically, remove duplicates and join
                    entries = splitEntries(entries);
                    entries.sort();
                    entries = entries.filter(function(item, pos, ary) {
                            return !pos || item != ary[pos - 1];
                        });
                    entries = entries.join('; ');

                    settings.set_string('ignore-list', entries);

                    close();
                }
            );

            let cancelButtonId = cancelButton.connect(
                'clicked',
                close
            );

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                close();
            }));

            dialog.show_all();

            function close() {
                buildable.get_object('ignore_list_add_button_save').disconnect(saveButtonId);
                buildable.get_object('ignore_list_add_button_cancel').disconnect(cancelButtonId);

                // remove the settings box so it doesn't get destroyed
                dialog.get_content_area().remove(sub_box);
                dialog.destroy();
                return;
            }
        }
    );

    buildable.get_object('ignore_list_toolbutton_remove').connect(
        'clicked',
        function() {removeEntry(settings);}
    );

    buildable.get_object('ignore_list_toolbutton_edit').connect(
        'clicked',
        function() {
            if (selected_entry < 0) return;

            let dialog = new Gtk.Dialog({ title: _('Edit entry'),
                                          transient_for: box.get_toplevel(),
                                          use_header_bar: true,
                                          modal: true });

            let sub_box = buildable.get_object('ignore_list_edit_dialog');
            dialog.get_content_area().add(sub_box);

            // Objects
            let entries = settings.get_string('ignore-list');
            if (!entries.length) return;
            entries = splitEntries(entries);

            let entry = buildable.get_object('ignore_list_edit_entry');
            let saveButton = buildable.get_object('ignore_list_edit_button_save');
            let cancelButton = buildable.get_object('ignore_list_edit_button_cancel');

            // Clean the entry in case it was already used
            entry.set_text(entries[selected_entry]);
            entry.connect('icon-release', Lang.bind(entry, function() {this.set_text('');}));

            let saveButtonId = saveButton.connect(
                'clicked',
                function() {
                    let name = entry.get_text();
                    let entries = settings.get_string('ignore-list');

                    if (entries.length > 0)
                        entries = entries + '; ' + name;
                    else
                        entries = name;

                    // Split, order alphabetically, remove duplicates and join
                    entries = splitEntries(entries);
                    entries.splice(selected_entry, 1);
                    entries.sort();
                    entries = entries.filter(function(item, pos, ary) {
                            return !pos || item != ary[pos - 1];
                        });
                    entries = entries.join('; ');

                    settings.set_string('ignore-list', entries);

                    close();
                }
            );

            let cancelButtonId = cancelButton.connect(
                'clicked',
                close
            );

            dialog.connect('response', Lang.bind(this, function(dialog, id) {
                close();
            }));

            dialog.show_all();

            function close() {
                buildable.get_object('ignore_list_edit_button_save').disconnect(saveButtonId);
                buildable.get_object('ignore_list_edit_button_cancel').disconnect(cancelButtonId);

                // remove the settings box so it doesn't get destroyed
                dialog.get_content_area().remove(sub_box);
                dialog.destroy();
                return;
            }
        }
    );


    box.show_all();

    return box;
};

let selected_entry = 0;

function selectionChanged(select, listStore) {
    let a = select.get_selected_rows(listStore)[0][0];

    if (a !== undefined)
        selected_entry = parseInt(a.to_string());
}

function removeEntry(settings) {
    let entries = settings.get_string('ignore-list');
    entries = splitEntries(entries);

    if (!entries.length || selected_entry < 0)
        return 0;

    if (entries.length > 0)
        entries.splice(selected_entry, 1);

    if (entries.length > 1)
        entries = entries.join('; ');
    else if (entries[0])
        entries = entries[0];
    else
        entries = '';

    settings.set_string('ignore-list', entries);

    return 0;
}

function splitEntries(entries) {
    entries = entries.split('; ');

    if (entries.length === 0)
        entries = [];

    if (entries.length > 0 && typeof entries != 'object')
        entries = [entries];

    return entries;
}

let list = null;
function refreshUI(listStore, treeview, settings) {
    let restoreForced = selected_entry;
    let entries = settings.get_string('ignore-list');
    if (list != entries) {
        if (listStore !== undefined)
            listStore.clear();

        if (entries.length > 0) {
            entries = String(entries).split('; ');

            if (entries && typeof entries == 'string')
                entries = [entries];

            let current = listStore.get_iter_first();

            for (let i in entries) {
                current = listStore.append();
                listStore.set_value(current, 0, entries[i]);
            }
        }

        list = entries;
    }

    selected_entry = restoreForced;
    changeSelection(treeview, entries);
}

function changeSelection(treeview, entries) {
    if (selected_entry < 0 || !entries.length)
        return;

    let max = entries.length - 1;
    if (selected_entry > max)
        selected_entry = max;

    let path = selected_entry;
    path = Gtk.TreePath.new_from_string(String(path));
    treeview.get_selection().select_path(path);
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
