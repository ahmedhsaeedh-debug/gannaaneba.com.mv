$ErrorActionPreference = "Stop"

$securePassword = Read-Host "Administrator password (minimum 12 characters)" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $env:GANNAANEBA_ADMIN_EMAIL = "ahmedhsaeedh@gmail.com"
    $env:GANNAANEBA_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    node .\server.js
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    Remove-Item Env:GANNAANEBA_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:GANNAANEBA_ADMIN_EMAIL -ErrorAction SilentlyContinue
}
