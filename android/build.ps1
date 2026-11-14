# Сборка APK без Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner
# Сборка идёт во временной папке с ASCII-путём: aapt2 не умеет кириллицу в путях.
param(
    [string]$SdkRoot = $env:ANDROID_SDK_ROOT,
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$VersionName = '1.0',
    [int]$VersionCode = 1
)

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$project = Split-Path -Parent $here

if (-not $SdkRoot) {
    $SdkRoot = Join-Path $env:LOCALAPPDATA 'Temp\opencode\android\sdk'
}
if (-not $JavaHome) {
    $jdkRoot = Join-Path $env:LOCALAPPDATA 'Temp\opencode\android\jdk'
    if (Test-Path $jdkRoot) {
        $JavaHome = (Get-ChildItem $jdkRoot -Directory | Select-Object -First 1).FullName
    }
}

$androidJar = Join-Path $SdkRoot 'platforms\android-34\android.jar'
$buildTools = Join-Path $SdkRoot 'build-tools\34.0.0'
$aapt2 = Join-Path $buildTools 'aapt2.exe'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$apksigner = Join-Path $buildTools 'apksigner.bat'
$d8 = Join-Path $buildTools 'd8.bat'
$javac = Join-Path $JavaHome 'bin\javac.exe'
$keytool = Join-Path $JavaHome 'bin\keytool.exe'
$jarTool = Join-Path $JavaHome 'bin\jar.exe'

foreach ($tool in @($androidJar, $aapt2, $zipalign, $apksigner, $d8, $javac, $keytool, $jarTool)) {
    if (-not (Test-Path $tool)) { throw "Не найден инструмент: $tool" }
}

$env:JAVA_HOME = $JavaHome
$env:PATH = (Join-Path $JavaHome 'bin') + ';' + $env:PATH

# --- площадка сборки с ASCII-путём ---
$stage = Join-Path $env:LOCALAPPDATA 'Temp\opencode\pokupki-stage'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Copy-Item (Join-Path $project 'index.html') $stage
Copy-Item (Join-Path $project 'styles.css') $stage
Copy-Item (Join-Path $project 'app.js') $stage
Copy-Item (Join-Path $project 'manifest.webmanifest') $stage
Copy-Item (Join-Path $project 'icons') $stage -Recurse
Copy-Item (Join-Path $here 'res') $stage -Recurse
Copy-Item (Join-Path $here 'java') $stage -Recurse
Copy-Item (Join-Path $here 'AndroidManifest.xml') $stage

$assets = Join-Path $stage 'assets'
$assetsRoot = Join-Path $stage 'assetsroot'
$build = Join-Path $stage 'build'
New-Item -ItemType Directory -Force -Path $assets, $assetsRoot, $build | Out-Null

Move-Item (Join-Path $stage 'index.html') $assets
Move-Item (Join-Path $stage 'styles.css') $assets
Move-Item (Join-Path $stage 'app.js') $assets
Move-Item (Join-Path $stage 'manifest.webmanifest') $assets
Move-Item (Join-Path $stage 'icons') $assets

# assets кладём через jar: aapt2 на Windows пишет в zip обратные слэши
Copy-Item $assets (Join-Path $assetsRoot 'assets') -Recurse

$keystore = Join-Path $here 'pokupki.keystore'
$stageKeystore = Join-Path $stage 'pokupki.keystore'
if (Test-Path $keystore) { Copy-Item $keystore $stageKeystore }

Write-Host '1/6 ресурсы (aapt2 compile + link)...'
$resZip = Join-Path $build 'res.zip'
& $aapt2 compile --dir (Join-Path $stage 'res') -o $resZip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

$apkUnsigned = Join-Path $build 'app-unsigned.apk'
& $aapt2 link `
    -o $apkUnsigned `
    -I $androidJar `
    --manifest (Join-Path $stage 'AndroidManifest.xml') `
    -R $resZip `
    --java (Join-Path $build 'gen') `
    --auto-add-overlay `
    --min-sdk-version 24 `
    --target-sdk-version 34 `
    --version-code $VersionCode `
    --version-name $VersionName
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

Write-Host '2/6 компиляция Java...'
$classes = Join-Path $build 'classes'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
$sources = @()
$sources += Get-ChildItem (Join-Path $stage 'java') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$sources += Get-ChildItem (Join-Path $build 'gen') -Recurse -Filter *.java | ForEach-Object { $_.FullName }

& $javac -encoding UTF-8 -source 1.8 -target 1.8 -bootclasspath $androidJar -Xlint:-options -d $classes $sources
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

Write-Host '3/6 dex (d8)...'
$dex = Join-Path $build 'dex'
New-Item -ItemType Directory -Force -Path $dex | Out-Null
$classFiles = Get-ChildItem $classes -Recurse -Filter *.class | ForEach-Object { $_.FullName }
& $d8 --lib $androidJar --release --min-api 24 --output $dex $classFiles
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

Write-Host '4/6 упаковка assets и classes.dex...'
& $jarTool --update --file $apkUnsigned -C $assetsRoot assets
if ($LASTEXITCODE -ne 0) { throw 'jar (assets) failed' }
& $jarTool --update --file $apkUnsigned -C $dex classes.dex
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }

Write-Host '5/6 zipalign + подпись...'
$apkAligned = Join-Path $build 'app-aligned.apk'
& $zipalign -p -f 4 $apkUnsigned $apkAligned
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

if (-not (Test-Path $stageKeystore)) {
    Write-Host '    создаётся ключ подписи...'
    & $keytool -genkeypair -v `
        -keystore $stageKeystore `
        -alias pokupki `
        -keyalg RSA `
        -keysize 2048 `
        -validity 12000 `
        -storepass pokupki `
        -keypass pokupki `
        -dname 'CN=Pokupki, O=Pokupki, C=RU' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}

$stageApk = Join-Path $build ("pokupki-" + $VersionName + ".apk")
& $apksigner sign `
    --ks $stageKeystore `
    --ks-key-alias pokupki `
    --ks-pass pass:pokupki `
    --key-pass pass:pokupki `
    --out $stageApk `
    $apkAligned
if ($LASTEXITCODE -ne 0) { throw 'apksigner sign failed' }

Write-Host '6/6 проверка...'
& $apksigner verify --print-certs $stageApk
& $aapt2 dump badging $stageApk | Select-String -Pattern 'package:|application-label|sdkVersion|targetSdkVersion|launchable-activity'

# --- результат рядом с проектом ---
$dist = Join-Path $here 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$finalApk = Join-Path $dist ("pokupki-" + $VersionName + ".apk")
Copy-Item $stageApk $finalApk -Force
if (Test-Path $stageKeystore) { Copy-Item $stageKeystore $keystore -Force }

Write-Host ''
Write-Host ("Готово: " + $finalApk)
Write-Host ("Размер: " + [math]::Round((Get-Item $finalApk).Length / 1KB, 1) + " КБ")
