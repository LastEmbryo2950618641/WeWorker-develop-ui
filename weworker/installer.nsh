; Release file handles before NSIS removes the Electron installation directory.
; WeWorker can remain in the tray after its window is closed, and the embedded
; website explorationagent has its own executable under resources/webwright.
!macro customRemoveFiles
  nsExec::ExecToLog 'taskkill /F /T /IM WeWorker.exe'
  nsExec::ExecToLog 'taskkill /F /T /IM Webwright.exe'
  Sleep 1500
  RMDir /r "$INSTDIR"
!macroend
