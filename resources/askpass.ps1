param([string]$prompt)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "SSH Security"
$form.Size = New-Object System.Drawing.Size(400,200)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Topmost = $true

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(10,15)
$label.Size = New-Object System.Drawing.Size(360,60)
$label.Text = $prompt

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Location = New-Object System.Drawing.Point(10,85)
$textBox.Size = New-Object System.Drawing.Size(360,20)
$textBox.PasswordChar = "*"

$okButton = New-Object System.Windows.Forms.Button
$okButton.Location = New-Object System.Drawing.Point(210,125)
$okButton.Size = New-Object System.Drawing.Size(75,23)
$okButton.Text = "OK"
$okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $okButton

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Location = New-Object System.Drawing.Point(295,125)
$cancelButton.Size = New-Object System.Drawing.Size(75,23)
$cancelButton.Text = "Cancel"
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancelButton

$form.Controls.Add($label)
$form.Controls.Add($textBox)
$form.Controls.Add($okButton)
$form.Controls.Add($cancelButton)

$form.ActiveControl = $textBox

$result = $form.ShowDialog()

if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $textBox.Text
} else {
    exit 1
}