; Native controls and AlgorithShot's paper/ink/yellow design. Installation,
; validation, updates, silent mode and uninstall remain owned by Tauri/NSIS.
!ifndef ALGORITHSHOT_THEME
!define ALGORITHSHOT_THEME
!addplugindir /x86-unicode "${__FILEDIR__}\..\target\installer-ui\x86"
!define MUI_BGCOLOR "F7F7F5"
!define MUI_TEXTCOLOR "111111"
!define MUI_INSTFILESPAGE_COLORS "111111 FFFFFF"
!define MUI_CUSTOMFUNCTION_GUIINIT ShotGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.ShotGuiInit
!define MUI_WELCOMEPAGE_TITLE "$(shotWelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(shotWelcomeBody)"
!define MUI_FINISHPAGE_TITLE "$(shotFinishTitle)"
!define MUI_FINISHPAGE_TEXT "$(shotFinishBody)"
!define MUI_FINISHPAGE_RUN_TEXT "$(shotRun)"
!define MUI_UNCONFIRMPAGE_TEXT_TOP "$(shotUninstallBody)"

Var ShotInner
Var ShotControl
Var ShotLanguage
Var ShotLanguageLabel
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

!macro SHOT_FEATURE NUMBER Y BODY_Y TITLE BODY TITLEHANDLE BODYHANDLE
  ${NSD_CreateLabel} 0 0 1 1 "${NUMBER}"
  Pop $ShotControl
  !insertmacro SHOT_MOVE $ShotControl 280 ${Y} 28 28 mono
  ${NSD_AddStyle} $ShotControl ${SS_CENTER}|${SS_CENTERIMAGE}
  SetCtlColors $ShotControl 111111 FFD300
  ${NSD_CreateLabel} 0 0 1 1 "${TITLE}"
  Pop ${TITLEHANDLE}
  !insertmacro SHOT_MOVE ${TITLEHANDLE} 325 ${Y} 435 24 label
  ${NSD_CreateLabel} 0 0 1 1 "${BODY}"
  Pop ${BODYHANDLE}
  !insertmacro SHOT_MOVE ${BODYHANDLE} 325 ${BODY_Y} 435 24 small
!macroend

!macro SHOT_COMMON_FUNCTIONS PREFIX
Function ${PREFIX}ShotGuiInit
  ShotUI::Shell /NOUNLOAD
  SetCtlColors $HWNDPARENT 111111 F7F7F5
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
  SetCtlColors $HWNDPARENT 111111 F7F7F5
  SetCtlColors $ShotInner 111111 F7F7F5
  System::Call 'user32::GetWindow(p $ShotInner, i 5) p .r0'
  ${While} $0 P<> 0
    SetCtlColors $0 111111 F7F7F5
    System::Call 'user32::GetClassNameW(p r0, w .r1, i ${NSIS_MAX_STRLEN})'
    System::Call 'user32::GetDlgCtrlID(p r0) i .r2'
    ${If} $1 == "Edit"
      SetCtlColors $0 111111 FFFFFF
    ${ElseIf} $2 == 1901
    ${OrIf} $2 == 1903
    ${OrIf} $2 == 1905
      SetCtlColors $0 62625D F7F7F5
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
  !insertmacro SHOT_MOVE $mui.WelcomePage.Title 280 66 480 70 title
  !insertmacro SHOT_MOVE $mui.WelcomePage.Text 280 145 480 62 body
  ${NSD_CreateLabel} 0 0 1 1 "$(shotWelcomeEyebrow)"
  Pop $ShotEyebrow
  !insertmacro SHOT_MOVE $ShotEyebrow 280 30 240 20 small
  ${NSD_CreateLabel} 0 0 1 1 "$(shotLanguage)"
  Pop $ShotLanguageLabel
  !insertmacro SHOT_MOVE $ShotLanguageLabel 568 30 50 20 small
  ${NSD_CreateDropList} 0 0 1 1 ""
  Pop $ShotLanguage
  !insertmacro SHOT_MOVE $ShotLanguage 620 24 140 150 body
  ${NSD_CB_AddString} $ShotLanguage "English"
  ${NSD_CB_AddString} $ShotLanguage "Oʻzbekcha"
  ${NSD_CB_AddString} $ShotLanguage "Русский"
  ${If} $LANGUAGE == ${LANG_UZBEK}
    SendMessage $ShotLanguage ${CB_SETCURSEL} 1 0
  ${ElseIf} $LANGUAGE == ${LANG_RUSSIAN}
    SendMessage $ShotLanguage ${CB_SETCURSEL} 2 0
  ${Else}
    SendMessage $ShotLanguage ${CB_SETCURSEL} 0 0
  ${EndIf}
  ${NSD_OnChange} $ShotLanguage ShotLanguageChanged
  Call ShotThemePage
  !insertmacro SHOT_FEATURE "01" 228 255 "$(shotCapture)" "$(shotCaptureBody)" $ShotFeature1 $ShotFeature1Body
  !insertmacro SHOT_FEATURE "02" 291 318 "$(shotEdit)" "$(shotEditBody)" $ShotFeature2 $ShotFeature2Body
  !insertmacro SHOT_FEATURE "03" 354 381 "$(shotFind)" "$(shotFindBody)" $ShotFeature3 $ShotFeature3Body
  Call ShotRefreshWelcome
FunctionEnd

Function ShotLanguageChanged
  Pop $ShotControl
  Push $0
  SendMessage $ShotLanguage ${CB_GETCURSEL} 0 0 $0
  ${If} $0 == 1
    StrCpy $LANGUAGE ${LANG_UZBEK}
  ${ElseIf} $0 == 2
    StrCpy $LANGUAGE ${LANG_RUSSIAN}
  ${Else}
    StrCpy $LANGUAGE ${LANG_ENGLISH}
  ${EndIf}
  Call ShotRefreshWelcome
  Pop $0
FunctionEnd

Function ShotRefreshWelcome
  SendMessage $HWNDPARENT ${WM_SETTEXT} 0 "STR:$(shotWindowTitle)"
  ${NSD_SetText} $ShotEyebrow "$(shotWelcomeEyebrow)"
  ${NSD_SetText} $ShotLanguageLabel "$(shotLanguage)"
  ${NSD_SetText} $mui.WelcomePage.Title "$(shotWelcomeTitle)"
  ${NSD_SetText} $mui.WelcomePage.Text "$(shotWelcomeBody)"
  ${NSD_SetText} $ShotFeature1 "$(shotCapture)"
  ${NSD_SetText} $ShotFeature2 "$(shotEdit)"
  ${NSD_SetText} $ShotFeature3 "$(shotFind)"
  ${NSD_SetText} $ShotFeature1Body "$(shotCaptureBody)"
  ${NSD_SetText} $ShotFeature2Body "$(shotEditBody)"
  ${NSD_SetText} $ShotFeature3Body "$(shotFindBody)"
  ${NSD_SetText} $mui.Button.Next "$(shotNext)"
  ${NSD_SetText} $mui.Button.Cancel "$(shotCancel)"
  SetCtlColors $mui.WelcomePage.Text 62625D F7F7F5
  SetCtlColors $ShotEyebrow 62625D F7F7F5
  SetCtlColors $ShotLanguageLabel 62625D F7F7F5
  SetCtlColors $ShotFeature1 111111 F7F7F5
  SetCtlColors $ShotFeature2 111111 F7F7F5
  SetCtlColors $ShotFeature3 111111 F7F7F5
  SetCtlColors $ShotFeature1Body 62625D F7F7F5
  SetCtlColors $ShotFeature2Body 62625D F7F7F5
  SetCtlColors $ShotFeature3Body 62625D F7F7F5
  WriteRegStr HKCU "${MANUPRODUCTKEY}" "Installer Language" $LANGUAGE
FunctionEnd

Function ShotDirectoryShow
  StrCpy $ShotInner $mui.DirectoryPage
  ShotUI::Page /NOUNLOAD "$ShotInner" "directory" "$(shotDirectoryTitle)" "$(shotDirectoryBody)" "$(shotDirectoryEyebrow)" "$(shotDestination)" "$(shotBrowse)" "$(shotDirectoryNote)" "WINDOWS  /  ${VERSION}"
  Call ShotThemePage
  SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(shotInstall)"
FunctionEnd

Function ShotFinishShow
  StrCpy $ShotInner $mui.FinishPage
  ShowWindow $mui.FinishPage.Image ${SW_HIDE}
  ShotUI::Page /NOUNLOAD "$ShotInner" "finish" "" "" "" "" "" "" "WINDOWS  /  ${VERSION}"
  !insertmacro SHOT_MOVE $mui.FinishPage.Title 280 66 480 70 title
  !insertmacro SHOT_MOVE $mui.FinishPage.Text 280 145 480 74 body
  !insertmacro SHOT_MOVE $mui.FinishPage.Run 280 302 480 24 body
  !insertmacro SHOT_MOVE $mui.FinishPage.ShowReadme 280 342 480 24 body
  ${NSD_CreateLabel} 0 0 1 1 "$(shotFinishEyebrow)"
  Pop $ShotEyebrow
  !insertmacro SHOT_MOVE $ShotEyebrow 280 30 480 20 small
  Call ShotThemePage
  SetCtlColors $ShotEyebrow 62625D F7F7F5
  SetCtlColors $mui.FinishPage.Text 62625D F7F7F5
  ${NSD_CreateLabel} 0 0 1 1 "Print Screen"
  Pop $ShotControl
  !insertmacro SHOT_MOVE $ShotControl 280 242 116 32 mono
  ${NSD_AddStyle} $ShotControl ${SS_CENTER}|${SS_CENTERIMAGE}
  SetCtlColors $ShotControl 111111 FFD300
  SendMessage $mui.Button.Next ${WM_SETTEXT} 0 "STR:$(shotFinish)"
FunctionEnd

Function ShotMaintenanceShow
  FindWindow $ShotInner "#32770" "" $HWNDPARENT
  Push $0
  Push $1
  ${NSD_GetText} $mui.Header.Text $0
  ${NSD_GetText} $mui.Header.SubText $1
  ShotUI::Page /NOUNLOAD "$ShotInner" "maintenance" "$0" "" "$1" "" "" "" "WINDOWS  /  ${VERSION}"
  Call ShotThemePage
  Pop $1
  Pop $0
FunctionEnd

Function un.ShotConfirmShow
  FindWindow $ShotInner "#32770" "" $HWNDPARENT
  ShotUI::Page /NOUNLOAD "$ShotInner" "confirm" "$(shotUninstallTitle)" "$(shotUninstallBody)" "$(shotUninstallSubtitle)" "" "" "" "WINDOWS  /  ${VERSION}"
  !insertmacro SHOT_MOVE $DeleteAppDataCheckbox 280 300 480 42 body
  Call un.ShotThemePage
FunctionEnd
!macroend
!endif