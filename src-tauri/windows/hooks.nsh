; Tauri 2 NSIS has no createDesktopShortcut schema key.
; Default installer only writes Desktop on silent/passive or via the finish-page
; checkbox. This hook always leaves one "Potion.lnk" on Desktop (product
; name + exe icon) and drops leftover cargo-name aliases.

!macro NSIS_HOOK_POSTINSTALL
  Delete "$DESKTOP\potion.lnk"
  Delete "$SMPROGRAMS\potion.lnk"
  ${If} $NoShortcutMode != 1
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$DESKTOP\potion.lnk"
  Delete "$DESKTOP\Potion.lnk"
!macroend
