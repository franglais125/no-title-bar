# Basic Makefile

UUID = no-title-bar@franglais125.gmail.com
BASE_MODULES = app_menu.js convenience.js extension.js prefs.js buttons.js decoration.js metadata.json Settings.ui utils.js
INSTALLNAME = no-title-bar@franglais125.gmail.com
MSGSRC = $(wildcard po/*.po)
ifeq ($(strip $(DESTDIR)),)
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
	RMTMP = echo Not deleting tmp as installation is local
else
	INSTALLBASE = $(DESTDIR)/usr/share/gnome-shell/extensions
	RMTMP = rm -rf ./_build/tmp
endif

# The command line passed variable VERSION is used to set the version string
# in the metadata and in the generated zip-file. If no VERSION is passed, the
# current commit SHA1 is used as version number in the metadata while the
# generated zip file has no string attached.
ifdef VERSION
	VSTRING = _v$(VERSION)
else
	VERSION = $(shell git rev-parse HEAD)
	VSTRING =
endif

all: extension

clean:
	rm -f ./schemas/gschemas.compiled
	rm -f ./po/*.mo

extension: ./schemas/gschemas.compiled $(MSGSRC:.po=.mo)

./schemas/gschemas.compiled: ./schemas/org.gnome.shell.extensions.no-title-bar.gschema.xml
	glib-compile-schemas ./schemas/

potfile: ./po/no-title-bar.pot

mergepo: potfile
	for l in $(MSGSRC); do \
		msgmerge -U $$l ./po/no-title-bar.pot; \
	done;

./po/no-title-bar.pot: Settings.ui
	mkdir -p po
	intltool-extract --type=gettext/glade Settings.ui
	xgettext -k -k_ -kN_ -o po/no-title-bar.pot Settings.ui.h

./po/%.mo: ./po/%.po
	msgfmt -c $< -o $@

install: install-local

install-local: _build
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)
	mkdir -p $(INSTALLBASE)/$(INSTALLNAME)
	cp -r ./_build/* $(INSTALLBASE)/$(INSTALLNAME)/
	-rm -fR _build
	echo done

zip-file: _build
	cd _build ; \
	zip -qr "$(UUID)$(VSTRING).zip" .
	mv _build/$(UUID)$(VSTRING).zip ./
	-rm -fR _build

_build: all
	-rm -fR ./_build
	mkdir -p _build
	cp $(BASE_MODULES) _build
	mkdir -p _build/themes
	cp -r themes/* _build/themes/
	mkdir -p _build/schemas
	cp schemas/*.xml _build/schemas/
	cp schemas/gschemas.compiled _build/schemas/
	mkdir -p _build/locale
	for l in $(MSGSRC:.po=.mo) ; do \
		lf=_build/locale/`basename $$l .mo`; \
		mkdir -p $$lf; \
		mkdir -p $$lf/LC_MESSAGES; \
		cp $$l $$lf/LC_MESSAGES/no-title-bar.mo; \
	done;
