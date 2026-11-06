; MapNG's additions to electron-builder's Windows installer (picked up from
; buildResources/installer.nsh). The install page showed only a bar: the app
; arrives as one archive, so there was nothing to list. Now the details list
; is open and says, in plain words, what is happening and where things go.

!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend

!macro customInstall
  DetailPrint ""
  DetailPrint "MapNG ${VERSION} is installed in:"
  DetailPrint "  $INSTDIR"
  DetailPrint "Included: the BeamNG level exporter and its own Node.js runtime,"
  DetailPrint "so nothing else needs installing."
  DetailPrint "Shortcuts: MapNG, on the desktop and in the Start menu."
  DetailPrint "Your settings, saved projects and levels are kept when you update"
  DetailPrint "or uninstall (settings in $APPDATA\MapNG; levels in BeamNG's mods folder)."
  DetailPrint ""
  DetailPrint "Done. Click Next, then Finish to start MapNG."
!macroend

!macro customUnInstall
  DetailPrint "Your settings in $APPDATA\MapNG and your levels in BeamNG's mods folder are kept."
!macroend
