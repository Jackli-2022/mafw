!macro customInstall
  ; Best-effort global gateway update (see docs/superpowers/specs/2026-09-17-desktop-installer-gateway-update-design.md).
  ; The script is fail-open: every failure path exits 0 and never blocks installation.
  nsExec::ExecToStack 'node --version'
  Pop $0
  ${If} $0 == 0
    nsExec::ExecToLog 'node "$INSTDIR\resources\gateway-update\update-global-gateway.js"'
    Pop $0
  ${EndIf}
!macroend
