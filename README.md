# No Title Bar

An extension for GNOME Shell that merges the activity bar and the title bar of maximized windows.

## Install From Source

```
make install
gnome-shell-extension-tool -e no-title-bar@franglais125.gmail.com
```

Restart GNOME Shell by pressing <kbd>Alt</kbd>+<kbd>F2</kbd> and entering <kbd>r</kbd>.

## Wayland

This extension does not work on native Wayland applications.
The necessary support is simply not available upstream, and can't be fixed at the extension level.

The extension will still work on applications making use of Xwayland.

## Dependencies

This extension depends on Xorg's `xprop` and `xwininfo` utilities. If not already
present on your system, these can be installed using:

- Debian/Ubuntu: `apt install x11-utils`
- Fedora/RHEL: `dnf install xorg-x11-utils`
- Arch: `pacman -S xorg-xprop`

## Credits

This is based on the Pixel-Saver extension, by @deadalnix: https://github.com/deadalnix/pixel-saver
