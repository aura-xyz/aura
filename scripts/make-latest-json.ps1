param(
    [Parameter(Mandatory = $true)][string]$BundleDir,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$Notes,
    [Parameter(Mandatory = $true)][string]$Repo
)

# 从 Tauri 构建产物生成 latest.json（Tauri updater 的更新清单）。
#
# 需要发布到 Release 的三样东西：
#   1. 安装包本体（供用户手动下载）
#   2. .sig 签名文件（updater 校验用）
#   3. latest.json（指向上面两者的下载地址）
#
# 本脚本负责组装 latest.json，不负责上传——上传仍在发版流程里手动完成，
# 因为 latest.json 里的下载地址必须是真实的 Release 资产 URL，
# 而 URL 只有在 Release 创建之后才确定。

$ErrorActionPreference = 'Stop'

# **必须按版本号过滤**。
#
# bundle/ 目录里会残留上一次的构建产物（0.5.0 的 exe/msi/sig 都在），
# 而 `Get-ChildItem` 的返回顺序不保证最新在前。此前用
# `Select-Object -First 1` 直接取，v0.5.1 发版时选中的却是 **0.5.0 的
# .sig**——manifest 里的 signature 与实际安装包不匹配，
# updater 的签名校验必然失败，而且是**静默失败**：检查更新一切正常，
# 点下载安装时才炸。
$nsis = Get-ChildItem -Path $BundleDir -Filter '*-setup.exe' -Recurse |
    Where-Object { $_.DirectoryName -match 'nsis' -and $_.BaseName -like "*_$Version*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
$msi = Get-ChildItem -Path $BundleDir -Filter '*.msi' -Recurse |
    Where-Object { $_.BaseName -like "*_$Version*" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if (-not $nsis) { throw "未找到 $Version 的 nsis 安装包，请确认已执行带签名的 tauri build" }

$nsisSigPath = "$($nsis.FullName).sig"
if (-not (Test-Path $nsisSigPath)) { throw "未找到 nsis 签名文件: $nsisSigPath" }
$msiSigPath = if ($msi -and (Test-Path "$($msi.FullName).sig")) { "$($msi.FullName).sig" } else { $null }

# MSI 存在却没有签名文件时**必须报错**：manifest 里会出现一个 signature
# 为空的条目，客户端选中 msi 架构时签名校验直接失败。
if ($msi -and -not $msiSigPath) {
    throw "找到 $Version 的 MSI 但缺少 .sig：$($msi.FullName).sig"
}

# 安装包统一放到 Release 的 Aura_<version>_win_x64_Setup.exe
$releaseName = "Aura_${Version}_win_x64_Setup.exe"

# **必须补成绝对 URL**。`-Repo` 允许传 "aura-xyz/aura" 或完整地址，两种都要归一。
# Tauri updater 拿到相对路径的 url 时不会在生成 manifest 时报错，只在客户端
# 点下载时才失败——静默失败。v0.5.1 发布时是手工改过这个前缀才正确的，
# 脚本本身一直有洞。
if ($Repo -notmatch '^https?://') { $Repo = "https://github.com/$Repo" }
$base = "$($Repo.TrimEnd('/'))/releases/download/v$Version"

# **platforms 必须是「对象」，键必须是 `<os>-<arch>[-<installer>]`**。
#
# 这是 v0.6.1 修的第二个致命格式错误：此前写成数组
# `[{architecture:"x86_64",url,signature}]`，而 tauri-plugin-updater 的
# RemoteReleaseInner::Static 要求 `platforms` 是 HashMap<String, {url,signature}>，
# 且键由 updater_os()+arch 拼成 `windows-x86_64` / `windows-x86_64-msi`。
# 数组在反序列化时直接失败 → check() 抛错 → 客户端永远「检查失败」，
# 与网络无关。四个版本都没发现，因为更新闭环从未被验证过。
$targets = @(
    @{ target = 'windows-x86_64';     url = "$base/$releaseName"; sig = $nsisSigPath }
)
if ($msi) {
    $targets += @{ target = 'windows-x86_64-msi'; url = "$base/Aura_${Version}_win_x64.msi"; sig = $msiSigPath }
}

# Tauri 要求签名字段去掉换行
function Read-Sig($path) {
    if (-not $path) { return '' }
    ((Get-Content -Raw -Encoding UTF8 $path) -replace "`r?`n", '')
}

$platforms = [ordered]@{}
foreach ($t in $targets) {
    $sig = Read-Sig $t.sig
    if (-not $sig) {
        throw "签名为空，拒绝生成 manifest：$($t.sig)"
    }
    # url 必须是绝对地址，否则客户端下载时才炸（见上面 $base 的注释）
    if ($t.url -notmatch '^https?://') {
        throw "下载地址不是绝对 URL，拒绝生成：$($t.url)"
    }
    # 自检：解码签名 blob，trusted comment 里的 version 必须与本次版本一致。
    # 比对同级目录里「同名 .sig」是废话（本来就是从它读的）；历史上出过
    # 「URL 指向新版本、签名取自旧版本」的事故，解码校验才抓得住。
    try {
        $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($sig))
    } catch {
        throw "签名不是合法的 minisign blob：$($t.sig)"
    }
    if (-not $decoded.Contains("version:$Version")) {
        throw "签名版本与本次发布不一致（期望 version:$Version）：$($t.sig)"
    }
    $platforms[$t.target] = @{ url = $t.url; signature = $sig }
}

$manifest = @{
    version   = $Version
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = $platforms
}

$json = $manifest | ConvertTo-Json -Depth 5
$out = Join-Path (Split-Path $BundleDir -Parent) 'latest.json'
[IO.File]::WriteAllText($out, $json, (New-Object Text.UTF8Encoding $false))
Write-Host "已生成 $out"
Write-Host "  选中安装包：$($nsis.Name)"
if ($msi) { Write-Host "  选中 MSI ：$($msi.Name)" }
Write-Host "请在 Release v$Version 中上传：$releaseName、Aura_${Version}_win_x64.msi 与 latest.json"