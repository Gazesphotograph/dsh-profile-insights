# 个人资料与用量洞察

为 DeepSeek Harness 提供个人资料页、Token 活动热力图、成本与预算、消耗时间线、会话明细和自定义头像。

插件：`@local/dsh-profile-insights` · 版本：**1.1.0**

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

## 成本与预算

打开侧边栏“个人资料”，在“成本与预算”中展开“预算与价格设置”：

- 设置每日和每月预算（USD）；留空表示不设置。提醒阈值默认 80%，达到 100% 显示超额。预算仅提醒，不中断会话。
- 查看输入、输出、缓存读取和缓存写入的单价。可以按“服务商 + 模型”填写自定义单价，单位为 USD / 百万 Token；明确免费填 0，未知缓存价格留空。支持恢复自动价格。
- 时间线支持近 7 / 30 / 90 天或全部时间、按天 / 周 / 月、Token / 成本切换及单会话筛选。点击柱形显示对应数值。
- 会话表支持搜索、按最近使用 / Token / 成本排序、分页和跳转到该会话的时间线。会话表展示完整历史，图表的时间筛选仅作用于图表。
- 页面可见时每 30 秒刷新；Host 使用 30 秒聚合缓存。保留原有头像、全年热力图和使用洞察。

## 定价与统计口径

价格源为 https://models.dev/api.json，与 CC Switch 当前源码的 `src-tauri/src/services/model_pricing.rs` 及 Magpie 的 `internal/catalog/catalog.go` 使用同一公开数据源。CC Switch 还维护内置价格及本地覆盖；本插件接入其公共价格同步来源。

价格表随插件附带快照，Host 保存最近成功更新的版本；超过 24 小时后在读取时后台更新，也支持手动更新。网络请求最多 15 秒，响应最多 32 MiB；更新失败继续保留原有价格。获取价格只访问公开目录，不上传会话或用量。

- 按精确模型 ID 或 models.dev 的 canonical_model_id 匹配。中转命名空间下的模型可匹配原厂公开价，标为“原厂公开价估算”；它不代表中转商实际收费。模型的 fast/max/auto 等后缀不会被模糊删除。
- 各 Token 桶互不重叠。输入为未缓存输入，缓存读取/写入分别计费；推理 Token 已计入输出，不重复累加。
- 按每次结算的完整输入规模（输入 + 缓存读取 + 缓存写入）选择价格目录中的上下文阶梯价。自定义价为固定单价。
- 沿用 Harness 的同一步重结算替换和重试累加规则；分支继承的旧事件不当作新消费，保留其路由信息供分支新请求使用。
- 缺模型价格或缺被使用的 Token 桶单价时，该次用量标为未定价，不当作免费；已定价成本旁显示加号及未定价次数。预算仅能覆盖已定价部分。
- 这是按当前价格重算历史的估算，不是历史账单。当前实现不计算订阅费、税费、汇率、按图片/音频单位收费、缓存保存时长、专用促销时段或服务商合同折扣。
- 时间按 Host 本地时区统计预算，客户端按查看者本地日历显示时间线。结算时间不是 Token 逐个生成的时间。

## 数据与接口

设置和价格缓存保存在当前 profile 的 `profile-insights` 子目录；desktop 当前路径为 `~/.dsh/profiles/desktop/profile-insights/`。`usage-settings.json` 保存预算与自定义价，`prices.json` 保存最近成功更新的价格。头像仍使用原有存储。

新增路由均通过原有 `connection.fetch` 认证：

| 路由 | 方法 | 用途 |
|---|---|---|
| `/api/dsh-profile-insights/usage-settings` | GET / PUT | 读取或保存预算与自定义价 |
| `/api/dsh-profile-insights/prices/refresh` | POST | 更新公开价格表 |

原有 `/stats` 和 `/refresh` 返回新增的 `usage` 字段。Token 会话日志仍然只读，不保存派生用量副本。


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
