/**
/*
    This file is part of Apt Update Indicator
    Apt Update Indicator is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    Apt Update Indicator is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with Apt Update Indicator.  If not, see <http://www.gnu.org/licenses/>.
    Copyright 2013 Amy Chan, mathematical.coffee@gmail.com
    Copyright 2013-7 Amaury Sechet, deadalnix@gmail.com
    Copyright 2017 Fran Glais, franglais125@gmail.com
*/
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Decoration = Me.imports.decoration;
const Buttons = Me.imports.buttons;
const AppMenu = Me.imports.app_menu;
const Utils = Me.imports.utils;

let decoration = null;
let buttons = null;
let appMenu = null;

function init() {
}

function enable() {
    let settings = Utils.enable();

    buttons = new Buttons.Buttons(settings);
    decoration = new Decoration.Decoration(settings);
    appMenu = new AppMenu.AppMenu(settings);
}

function disable() {
    appMenu.destroy();
    appMenu = null;
    decoration.destroy();
    decoration = null;
    buttons.destroy();
    buttons = null;

    Utils.disable();
}

