; MapNG's additions to electron-builder's Windows installer (picked up from
; buildResources/installer.nsh). The install page showed only a bar: the app
; arrives as one archive, so there was nothing to list. Now the details list
; is open and says, in plain words, what is happening and where things go.

!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend

; Right after the app's files are copied, before the uninstaller is written:
; if the app is not there, the folder could not be written to (the copy does
; not say so itself, and the next thing the user saw was "Error opening file
; for writing: Uninstall MapNG.exe" with Abort / Retry / Ignore). Say what
; happened and what to do, then stop.
!macro customFiles_x64
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" mapngFilesWritten 0
    MessageBox MB_OK|MB_ICONSTOP "MapNG could not write its files to:$\r$\n$INSTDIR$\r$\n$\r$\nWindows did not allow it. Run the installer again and either keep the folder it suggests, or choose $\"Anyone who uses this computer$\" on the first page (it asks for administrator rights and can then use any folder).$\r$\n$\r$\nNo installer at all: the portable zip on the same download page."
    Quit
  mapngFilesWritten:
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
