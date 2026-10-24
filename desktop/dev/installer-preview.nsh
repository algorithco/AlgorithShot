; This fixture is compiled only into the non-installing preview executable.
Function PreviewWelcome
  Call ShotWelcomeShow
  ShotUI::TestPage /NOUNLOAD "${PREVIEW_OUTPUT}\welcome-$LANGUAGE.bmp" "1"
FunctionEnd
Function PreviewDirectory
  Call ShotDirectoryShow
  ShotUI::TestPage /NOUNLOAD "${PREVIEW_OUTPUT}\directory-$LANGUAGE.bmp" "1"
FunctionEnd
Function PreviewProgress
  Call ShotProgressShow
  ShotUI::TestPage /NOUNLOAD "${PREVIEW_OUTPUT}\progress-$LANGUAGE.bmp" "0"
FunctionEnd
Function PreviewFinish
  Call ShotFinishShow
  ShotUI::TestPage /NOUNLOAD "${PREVIEW_OUTPUT}\finish-$LANGUAGE.bmp" "2"
FunctionEnd
Function un.PreviewConfirm
  Call un.ConfirmShow
  ShotUI::TestPage /NOUNLOAD "${PREVIEW_OUTPUT}\uninstall-$LANGUAGE.bmp" "1"
FunctionEnd
Function un.PreviewProgress
  Call un.ShotProgressShow
  ShotUI::TestPage /NOUNLOAD "${PREVIEW_OUTPUT}\removing-$LANGUAGE.bmp" "2"
FunctionEnd
