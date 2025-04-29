!define APPNAME "CCD Tunnel Helper"
!define COMPANY "CCD Ltd"
!define DESCRIPTION "Auto-connect SSH tunnels via ccd-tunnel:// links"
!define VERSION "1.0.0"
!define ICON "../../src/ccd-tunnel-helper.ico"

Outfile "ccd-tunnel-helper-setup.exe"
InstallDir "$PROGRAMFILES\${APPNAME}"
InstallDirRegKey HKLM "Software\${APPNAME}" "Install_Dir"
RequestExecutionLevel admin
Icon "${ICON}"

XPStyle on

Caption "${APPNAME} Setup"

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "ProductVersion" "1.0.0.0"
VIAddVersionKey "FileVersion" "1.0.0.0"
VIAddVersionKey "FileDescription" "${DESCRIPTION}"
VIAddVersionKey "OriginalFilename" "ccd-tunnel-helper-setup.exe"
VIAddVersionKey "InternalName" "${APPNAME} Installer"
VIAddVersionKey "CompanyName" "${COMPANY}"
VIAddVersionKey "LegalCopyright" "Copyright (C) 2025 ${COMPANY}"

!include "MUI2.nsh"

;--------------------------------
; MUI Settings

!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Are you sure you want to quit ${APPNAME} Setup?"
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${APPNAME} Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will install ${APPNAME}.$\r$\n$\r$\nIt is recommended that you close all other applications before continuing.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_TITLE "${APPNAME} Installed"
!define MUI_FINISHPAGE_TEXT "${APPNAME} has been successfully installed on your computer.$\r$\n$\r$\nClick Finish to close the Setup Wizard."
!define MUI_ICON "${ICON}"

; Welcome and Finish pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; Language files
!insertmacro MUI_LANGUAGE "English"

;--------------------------------
Section "Install"
  SetOutPath "$INSTDIR"
  File "..\..\dist\ccd-tunnel-helper-win.exe"

  ; Save install path
  WriteRegStr HKLM "Software\${APPNAME}" "Install_Dir" "$INSTDIR"

  ; Protocol Handler Registration
  WriteRegStr HKCR "ccd-tunnel" "" "URL:${APPNAME} Protocol"
  WriteRegStr HKCR "ccd-tunnel" "URL Protocol" ""
  WriteRegStr HKCR "ccd-tunnel\shell\open\command" "" '"$INSTDIR\ccd-tunnel-helper-win.exe" "%1"'

  ; Uninstaller
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\ccd-tunnel-helper-win.exe"
  Delete "$INSTDIR\Uninstall.exe"
  DeleteRegKey HKCR "ccd-tunnel"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
  DeleteRegKey HKLM "Software\${APPNAME}"
  RMDir "$INSTDIR"
SectionEnd
