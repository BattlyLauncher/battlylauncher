# Also cover ZIP/custom-installer installations without an NSIS registry entry.
# Elevate BEFORE CHECK_APP_RUNNING or uninstallOldVersion touches the old app.
!macro customInit
  ${If} ${isUpdated}
  ${AndIfNot} ${UAC_IsAdmin}
    ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      ClearErrors
      GetTempFileName $R0 "$INSTDIR"
      ${If} ${Errors}
        !insertmacro UAC_RunElevated
        ${If} $0 != 0
          SetErrorLevel $0
        ${EndIf}
        Quit
      ${Else}
        Delete "$R0"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
