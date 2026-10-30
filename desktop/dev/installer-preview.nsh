; This fixture is compiled only into the non-installing preview executable.
!macro SHOT_PREVIEW_CAPTURE NAME ADVANCE
  !ifndef SHOT_PREVIEW_INTERACTIVE
    ShotUI::TestPage /NOUNLOAD "${PREVIEW_OUTPUT}\${NAME}-$LANGUAGE.bmp" "${ADVANCE}"
  !endif
!macroend

Function PreviewWelcome
  Call ShotWelcomeShow
  !insertmacro SHOT_PREVIEW_CAPTURE welcome 1
FunctionEnd
; Exercise the production maintenance layout with fixture data. No registry
; lookup, existing-install detection or uninstall command is executed.
Function PreviewMaintenance
  !insertmacro MUI_HEADER_TEXT "$(alreadyInstalled)" "$(chooseMaintenanceOption)"
  nsDialogs::Create 1018
  Pop $R4
  ${NSD_CreateLabel} 0 0 100% 24u "$(alreadyInstalledLong)"
  Pop $R1
  ${NSD_CreateRadioButton} 30u 50u -30u 8u "$(addOrReinstall)"
  Pop $R2
  ${NSD_Check} $R2
  ${NSD_CreateRadioButton} 30u 70u -30u 8u "$(uninstallApp)"
  Pop $R3
  Call ShotMaintenanceShow
  !insertmacro SHOT_PREVIEW_CAPTURE maintenance 1
  nsDialogs::Show
FunctionEnd
Function PreviewDirectory
  Call ShotDirectoryShow
  !insertmacro SHOT_PREVIEW_CAPTURE directory 1
FunctionEnd
!if "${LICENSE}" != ""
Function PreviewLicense
  Call ShotLicenseShow
  !insertmacro SHOT_PREVIEW_CAPTURE license 1
FunctionEnd
!endif
Function PreviewProgress
  Call ShotProgressShow
  !insertmacro SHOT_PREVIEW_CAPTURE progress 0
FunctionEnd
Function PreviewFinish
  Call ShotFinishShow
  !insertmacro SHOT_PREVIEW_CAPTURE finish 2
FunctionEnd
Function un.PreviewConfirm
  Call un.ConfirmShow
  !insertmacro SHOT_PREVIEW_CAPTURE uninstall 1
FunctionEnd
Function un.PreviewProgress
  Call un.ShotProgressShow
  !insertmacro SHOT_PREVIEW_CAPTURE removing 2
FunctionEnd
