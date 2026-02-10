param([string]$prompt)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$isConfirmation = $prompt -match "continue connecting" -or $prompt -match "authenticity of host"

$form = New-Object System.Windows.Forms.Form
$form.Text = "SSH Security"
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Topmost = $true

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(10,15)
$label.Text = $prompt
$label.Size = New-Object System.Drawing.Size(425,100)

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Size = New-Object System.Drawing.Size(425,20)
$textBox.PasswordChar = "*"

$okButton = New-Object System.Windows.Forms.Button
$okButton.Size = New-Object System.Drawing.Size(95,30)
$okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $okButton

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Size = New-Object System.Drawing.Size(95,30)
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancelButton

if ($isConfirmation) {
    $form.Size = New-Object System.Drawing.Size(460, 220)

    $okButton.Text = "Yes"
    $okButton.Location = New-Object System.Drawing.Point(235, 125)

    $cancelButton.Text = "No"
    $cancelButton.Location = New-Object System.Drawing.Point(340, 125)

    $textBox.Visible = $false
} else {
    $form.Size = New-Object System.Drawing.Size(460, 240)

    $textBox.Location = New-Object System.Drawing.Point(10,125)

    $okButton.Text = "OK"
    $okButton.Location = New-Object System.Drawing.Point(235, 160)

    $cancelButton.Text = "Cancel"
    $cancelButton.Location = New-Object System.Drawing.Point(340, 160)
}

$form.Controls.Add($label)
$form.Controls.Add($textBox)
$form.Controls.Add($okButton)
$form.Controls.Add($cancelButton)

if (-not $isConfirmation) {
    $form.ActiveControl = $textBox
}

$result = $form.ShowDialog()

if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    if ($isConfirmation) {
        Write-Output "yes"
    } else {
        Write-Output $textBox.Text
    }
} else {
    if ($isConfirmation) {
        Write-Output "no"
    }
    exit 1
}