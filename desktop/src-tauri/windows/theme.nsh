; Native controls and AlgorithShot's paper/ink/yellow design. Installation,
; validation, updates, silent mode and uninstall remain owned by Tauri/NSIS.
!ifndef ALGORITHSHOT_THEME
!define ALGORITHSHOT_THEME
!addplugindir /x86-unicode "${__FILEDIR__}\..\target\installer-ui\x86"
!define MUI_BGCOLOR "FFFFFF"
!define MUI_TEXTCOLOR "171A21"
!define MUI_INSTFILESPAGE_COLORS "171A21 FFFFFF"
!define MUI_CUSTOMFUNCTION_GUIINIT ShotGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.ShotGuiInit
!define MUI_WELCOMEPAGE_TITLE "$(shotWelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(shotWelcomeBody)"
!define MUI_FINISHPAGE_TITLE "$(shotFinishTitle)"
!define MUI_FINISHPAGE_TEXT "$(shotFinishBody)"
!define MUI_FINISHPAGE_RUN_TEXT "$(shotRun)"
!define MUI_UNCONFIRMPAGE_TEXT_TOP "$(shotUninstallBody)"

Var ShotInner
Var ShotEyebrow
Var ShotFeature1
Var ShotFeature2
Var ShotFeature3
Var ShotFeature1Body
Var ShotFeature2Body
Var ShotFeature3Body

!macro SHOT_MOVE HANDLE X Y WIDTH HEIGHT FONT
  ShotUI::MoveControl /NOUNLOAD "${HANDLE}" "${X}" "${Y}" "${WIDTH}" "${HEIGHT}" "${FONT}"
!macroend

!macro SHOT_FEATURE Y BODY_Y TITLE BODY TITLEHANDLE BODYHANDLE
  ${NSD_CreateLabel} 0 0 1 1 "${TITLE}"
  Pop ${TITLEHANDLE}
  !insertmacro SHOT_MOVE ${TITLEHANDLE} 96 ${Y} 604 24 label
  ${NSD_CreateLabel} 0 0 1 1 "${BODY}"
  Pop ${BODYHANDLE}
  !insertmacro SHOT_MOVE ${BODYHANDLE} 96 ${BODY_Y} 604 24 body
!macroend

!macro SHOT_COMMON_FUNCTIONS PREFIX
Function ${PREFIX}ShotGuiInit
  ShotUI::Shell /NOUNLOAD
  SetCtlColors $HWNDPARENT 171A21 FFFFFF
FunctionEnd

Function ${PREFIX}ShotThemePage
  Push $0
  Push $1
  Push $2
  !if "${PREFIX}" == ""
    SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:$(shotWindowTitle)"
  !else
    SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:$(shotRemoveWindowTitle)"
  !endif
  SendMessage $mui.Button.Back ${WM_SETTEXT} 0 "STR:$(shotBack)"
  SendMessage $mui.Button.Cancel ${WM_SETTEXT} 0 "STR:$(shotCancel)"
  SetCtlColors $HWNDPARENT 171A21 FFFFFF
  SetCtlColors $ShotInner 171A21 FFFFFF
  System::Call 'user32::GetWindow(p $ShotInner, i 5) p .r0'
  ${While} $0 P<> 0
    SetCtlColors $0 171A21 FFFFFF
    System::Call 'user32::GetClassNameW(p r0, w .r1, i ${NSIS_MAX_STRLEN})'
    System::Call 'user32::GetDlgCtrlID(p r0) i .r2'
    ${If} $1 == "Edit"
      SetCtlColors $0 171A21 FFFFFF
    ${ElseIf} $2 == 1901
    ${OrIf} $2 == 1903
    ${OrIf} $2 == 1905
    ${OrIf} $2 == 1023
    ${OrIf} $2 == 1024
      SetCtlColors $0 626872 FFFFFF
    ${EndIf}
    System::Call 'user32::GetWindow(p r0, i 2) p .r0'
  ${EndWhile}
  ShotUI::Navigation /NOUNLOAD
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function ${PREFIX}ShotProgressShow
  StrCpy $ShotInner $mui.InstFilesPage
  !if "${PREFIX}" == ""
    ShotUI::Page /NOUNLOAD "$ShotInner" "progress" "$(shotInstallingTitle)" "$(shotInstallingSubtitle)" "$(shotInstallingEyebrow)" "" "$(shotDetails)" "" "WINDOWS  /  ${VERSION}"
  !else
    ShotUI::Page /NOUNLOAD "$ShotInner" "progress" "$(shotRemovingTitle)" "$(shotRemovingSubtitle)" "$(shotUninstallTitle)" "" "$(shotDetails)" "" "WINDOWS  /  ${VERSION}"
  !endif
  Call ${PREFIX}ShotThemePage
FunctionEnd
!macroend

!macro SHOT_THEME_FUNCTIONS
!insertmacro SHOT_COMMON_FUNCTIONS ""
!insertmacro SHOT_COMMON_FUNCTIONS "un."

Function ShotWelcomeShow
  StrCpy $ShotInner $mui.WelcomePage
  ShowWindow $mui.WelcomePage.Image ${SW_HIDE}
  ShotUI::Page /NOUNLOAD "$ShotInner" "welcome" "" "" "" "" "" "" "WINDOWS  /  ${VERSION}"
  !insertmacro SHOT_MOVE $mui.WelcomePage.Title 40 128 660 42 title
  !insertmacro SHOT_MOVE $mui.WelcomePage.Text 40 180 660 44 body
  ${NSD_CreateLabel} 0 0 1 1 "$(shotWelcomeEyebrow)"
  Pop $ShotEyebrow
  !insertmacro SHOT_MOVE $ShotEyebrow 40 104 660 20 small
  Call ShotThemePage
  !insertmacro SHOT_FEATURE 240 264 "$(shotCapture)" "$(shotCaptureBody)" $ShotFeature1 $ShotFeature1Body
  !insertmacro SHOT_FEATURE 302 326 "$(shotEdit)" "$(shotEditBody)" $ShotFeature2 $ShotFeature2Body
  !insertmacro SHOT_FEATURE 364 388 "$(shotFind)" "$(shotFindBody)" $ShotFeature3 $ShotFeature3Body
  ${NSD_SetText} $mui.Button.Next "$(shotNext)"
  ${NSD_SetText} $mui.Button.Cancel "$(shotCancel)"
  SetCtlColors $mui.WelcomePage.Text 626872 FFFFFF
  SetCtlColors $ShotEyebrow 626872 FFFFFF
  SetCtlColors $ShotFeature1 171A21 FFFFFF
  SetCtlColors $ShotFeature2 171A21 FFFFFF
  SetCtlColors $ShotFeature3 171A21 FFFFFF
  SetCtlColors $ShotFeature1Body 626872 FFFFFF
  SetCtlColors $ShotFeature2Body 626872 FFFFFF
  SetCtlColors $ShotFeature3Body 626872 FFFFFF
FunctionEnd

Function ShotDirectoryShow
  StrCpy $ShotInner $mui.DirectoryPage
  ShotUI::Page /NOUNLOAD "$ShotInner" "directory" "$(shotDirectoryTitle)" "$(shotDirectoryBody)" "$(shotDirectoryEyebrow)" "$(shotDestination)" "$(shotBrowse)" "$(shotDirectoryNote)" "WINDOWS  /  ${VERSION}"
  Call ShotThemePage
  SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(shotInstall)"
FunctionEnd

!if "${LICENSE}" != ""
Function ShotLicenseShow
  StrCpy $ShotInner $mui.LicensePage
  ShotUI::Page /NOUNLOAD "$ShotInner" "license" "$(shotLicenseTitle)" "$(shotLicenseBody)" "$(shotLicenseEyebrow)" "" "" "$(shotLicenseNote)" "WINDOWS  /  ${VERSION}"
  Call ShotThemePage
  SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(shotAgree)"
FunctionEnd
!endif

Function ShotFinishShow
  StrCpy $ShotInner $mui.FinishPage
  ShowWindow $mui.FinishPage.Image ${SW_HIDE}
  ShotUI::Page /NOUNLOAD "$ShotInner" "finish" "" "" "" "" "" "" "WINDOWS  /  ${VERSION}"
  !insertmacro SHOT_MOVE $mui.FinishPage.Title 40 128 660 42 title
  !insertmacro SHOT_MOVE $mui.FinishPage.Text 40 180 660 44 body
  !insertmacro SHOT_MOVE $mui.FinishPage.Run 60 264 620 24 body
  !insertmacro SHOT_MOVE $mui.FinishPage.ShowReadme 60 308 620 24 body
  ${NSD_CreateLabel} 0 0 1 1 "$(shotFinishEyebrow)"
  Pop $ShotEyebrow
  !insertmacro SHOT_MOVE $ShotEyebrow 40 104 660 20 small
  Call ShotThemePage
  SetCtlColors $ShotEyebrow 626872 FFFFFF
  SetCtlColors $mui.FinishPage.Text 626872 FFFFFF
  SetCtlColors $mui.FinishPage.Run 171A21 F8F9FB
  SetCtlColors $mui.FinishPage.ShowReadme 171A21 F8F9FB
  ShowWindow $mui.Button.Back ${SW_HIDE}
  ShowWindow $mui.Button.Cancel ${SW_HIDE}
  SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(shotFinish)"
FunctionEnd

Function ShotMaintenanceShow
  ; PageReinstall receives this exact dialog handle from nsDialogs::Create.
  ; A class-name search can select the previous wizard page during transition.
  StrCpy $ShotInner $R4
  Push $0
  ${NSD_GetText} $mui.Header.Text $0
  ShotUI::Page /NOUNLOAD "$ShotInner" "maintenance" "$0" "" "$(shotMaintenanceEyebrow)" "" "" "" "WINDOWS  /  ${VERSION}"
  Call ShotThemePage
  SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(shotNext)"
  Pop $0
FunctionEnd

Function un.ShotConfirmShow
  FindWindow $ShotInner "#32770" "" $HWNDPARENT
  ShotUI::Page /NOUNLOAD "$ShotInner" "confirm" "$(shotUninstallTitle)" "$(shotUninstallBody)" "$(shotUninstallSubtitle)" "" "" "" "WINDOWS  /  ${VERSION}"
  !insertmacro SHOT_MOVE $DeleteAppDataCheckbox 40 312 660 42 body
  Call un.ShotThemePage
FunctionEnd
!macroend
!endif
