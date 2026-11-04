# 个人资料与用量洞察

为 DeepSeek Harness 提供个人资料页、Token 活动热力图、用量洞察和自定义头像。

插件：`@local/dsh-profile-insights` · 版本：**1.0.1**

适用版本：**DeepSeek Harness 0.2.1-rc.5**。

## 功能与数据

- 侧栏个人资料页面：身份、头像、会话和用量总览。
- 按天、按周和累计显示 Token 活动，以及模型、工具、技能和推理强度统计。
- 支持上传或恢复头像；自定义头像在当前 profile 数据目录下单独保存。

统计读取当前用户的会话记录，使用本地日期分桶，在内存中缓存 30 秒。
默认展示 365 天，支持配置 7–730 天；重试采用替换/追加规则，避免重复计数。
缺失或损坏的会话会跳过；账号和技能服务超时会降级显示。
统计反映本地可读取记录，不等同于官方计费账单。

API 路径为 `/api/dsh-profile-insights/{stats,refresh,avatar}`，通过 DSH 原有
connection 认证通道注册。上传头像为 PNG，最大 2 MiB，正方形且边长不超过 512px。
仓库只包含插件自带的默认头像，不包含运行时上传的自定义头像或会话数据库。

## 安装

克隆仓库到固定目录后，在仓库根目录打开 PowerShell：

```powershell
$dsh = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'
& $dsh plugin --profile desktop add (Get-Location).Path
```

如 Harness 安装在其他位置，把 `$dsh` 改为对应 CLI 路径。插件使用 DSH
提供的服务，无需自行安装 React 或其他前端运行依赖。安装后刷新页面；涉及
原生启动配置时完整重启桌面程序。使用其他 profile 时替换 `desktop`。

卸载：

```powershell
& $dsh plugin --profile desktop remove @local/dsh-profile-insights
```

## 验证

使用 Node.js 22.15 或更新版本，在仓库根目录运行：

```powershell
npm test
npm pack --dry-run
```

`tests/` 包含使用本地代码、模拟服务或临时目录的离线回归检查，无需账户密钥。
这些检查不覆盖安装后的完整桌面交互，界面兼容性需在对应 Harness 版本中确认。

## 目录

- `index.js`：Host 服务入口。
- `package.json`、`cordis.patch.yml`：DSH bundle 元数据与加载配置。
- `tests/`：可复跑检查。
- `client.js`、`locale/`、`icon.svg`：客户端页面和界面资源。
