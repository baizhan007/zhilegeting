# 《支了个婷》Gemini 开发交接文档

> 交接日期：2026-08-09（Asia/Shanghai）  
> 工作区：`D:\AI\opencodeFiles\O8.7`  
> 产品形态：移动端优先的每日三消挑战，目前已达到网页/PWA/单文件分享版的发布候选状态。  
> 交接对象：Gemini 模型（后续开发、真机验收和发布决策）

这份文档按“拿到代码即可继续工作”的标准编写。先看第 1、2、8、9 节，再开始改代码；不要把本文件中的推测当成已验证事实。

## 1. 当前结论（先读）

当前版本已经解决了本轮反馈的三个核心问题：

1. 音乐无声：改为 `AudioEngine` Web Audio 合成引擎，在可信用户手势中解锁，增加 iOS 静音 buffer、挂起/中断恢复、页面生命周期处理和音量总线。
2. 手机文字靠边：统一使用 `20px + safe-area` 的外围安全边距，竖屏、窄屏和横屏均做过无横向溢出检查。
3. 牌局太简单：第二关不再是均匀平铺的普通洗牌，而是 126 张牌、中央深堆、左右受限长列、浅层缓冲区和显式遮挡 DAG；同时保留确定性和无道具见证解。

自动化基线（2026-08-09 00:37，源码已重建分享版后执行）：

```text
node --test tests/challenge-engine.test.mjs tests/audio-engine.test.mjs   PASS（15/15）
python tests/verify_release.py                                           PASS
python tests/browser_smoke.py                                             PASS
python tests/pwa_smoke.py                                                 PASS
```

当前分享包：

- 文件：[支了个婷_手机分享版.html](支了个婷_手机分享版.html)
- 大小：412,585 bytes
- SHA-256：`3FBD0508128C6CA84AD8F989D1A70216E84E7918E09259B5B759F357753406CC`

需要明确区分的边界：

- 已验证：网页 HTTP 运行、PWA 离线重载、`file://` 单文件运行、自动化视口和 Web Audio 状态机。
- 尚未验证：真实 iPhone Safari 扬声器、Android 微信内置浏览器扬声器、来电/切后台后的实际听感。
- 尚未交付：原生 App Store/Google Play 容器、签名、商店截图、商店隐私 URL、应用包和审核材料。

因此，当前可以称为“网页/PWA 发布候选”，不能在没有真机和目标商店材料的情况下称为“原生应用已上架”。

版本管理提醒：当前目录不是 Git 仓库，没有 `.git`、提交号或可直接使用的回滚分支。Gemini 在继续修改前应先复制一份工作区，或在获得授权后初始化 Git 并提交当前基线；不要假设可以用 `git checkout` 恢复文件。

## 2. 产品与玩法概览

产品名是“支了个婷”，灵感是把一组带表情的婷卡牌做成每日挑战。所有日期牌局在本地按日期稳定生成；没有账号、广告、统计 SDK 或后端。

### 2.1 两关流程

| 关卡 | 代码 key | 牌数 | 图案数 | 目的 |
|---|---|---:|---:|---|
| 热身局 | `warmup` | 18（两层各 9） | 6 | 让玩家理解点击、三消和卡槽 |
| 挑战局 | `challenge` | 126 | 10 | 每日主要难度，使用 `ChallengeEngine` |

核心规则：

- 每种图案 3 张组成一组，凑齐后从卡槽消除。
- 主卡槽容量为 7；满槽即失败。
- 暂存区容量为 3，每局一次；撤回一次；洗牌一次。
- 牌进入卡槽后按图案排序，连续三张相同即可消除。
- 计分以 100 分为基础，连击增加倍率；第二关有额外关卡加分。
- 牌局按本地日期生成；同一天重复开始会得到同一挑战布局。

### 2.2 玩家状态与主要流程

`script.js` 使用模块级状态（不是 React/Vue）：

```text
pile                仍在牌堆中的牌
slot                主卡槽中的牌
stash               暂存区中的牌
history             用于一次撤回的动作记录
allCards            当前关全部牌对象
stageIndex          0=热身，1=挑战
score               总分
hasUsedUndo/Stash/Shuffle  三种道具是否已使用
gameActive          是否在游戏页
isResolving         三消动画期间的锁
lifecyclePaused     页面隐藏/后台时的暂停标记
```

典型调用链：

```text
DOMContentLoaded -> init -> bindEvents
开始按钮 -> primeAudio -> startNewRun/resumeGame
startNewRun -> startStage(0)
通关第一关 -> startStage(1)
startStage(1) -> ChallengeEngine.generateChallenge(seedFromDate(todayKey()))
点击牌 -> handleCardClick -> findMatch/resolveMatch -> checkGameState/saveGame
visibility/pagehide -> pauseGameForLifecycle
pageshow/foreground -> resumeGameFromLifecycle
```

## 3. 文件地图与归属

| 文件 | 责任 | 修改时必须注意 |
|---|---|---|
| `index.html` | HTML 壳、语义结构、脚本加载顺序、版本查询参数 | 运行时顺序必须是 `challenge-engine.js` → `audio-engine.js` → `script.js`；新增运行时文件要同步 `sw.js` 和 `build.py` 逻辑 |
| `script.js` | 游戏状态、渲染、输入、计分、道具、存档、分享、PWA 安装事件 | 这是唯一的主控制器；不要在引擎里直接操作 DOM |
| `challenge-engine.js` | 纯确定性第二关生成器、遮挡图、见证解、统计和校验 | 尽量保持无 DOM、可在 Node 中直接 `require`；修改拓扑必须更新 365 seed 测试 |
| `audio-engine.js` | Web Audio 合成音乐/音效、解锁、生命周期恢复 | 不要在页面加载时主动 `resume()`；首次解锁必须来自可信手势 |
| `style.css` | 页面布局、牌面、响应式和动画 | 外围内容使用安全边距 token；先跑 320×568 和横屏检查 |
| `tokens.css` | 颜色、字体、间距、safe-area token | `--mobile-safe-gutter` 当前为 `1.25rem` |
| `sw.js` | PWA app shell、缓存版本和离线导航 fallback | 修改资源后提升 `CACHE_NAME` 的数字版本 |
| `manifest.webmanifest` | PWA 名称、图标、主题色、显示模式 | 必须保留 192×192 和 512×512 图标 |
| `build.py` | 将 CSS、JS、图片等内联成单 HTML | 新增本地运行时资源要保证能被构建器发现并内联 |
| `支了个婷_手机分享版.html` | 可直接通过 `file://` 分享的构建产物 | 不直接手改；运行 `python build.py` 生成 |
| `tests/challenge-engine.test.mjs` | 引擎结构、确定性、DAG、365 日验证 | 改生成器后先跑它 |
| `tests/audio-engine.test.mjs` | 10 项 Web Audio 状态机/生命周期测试 | 不代表真实扬声器音量，仍需真机 |
| `tests/browser_smoke.py` | Playwright 视口、挑战流程、见证解、道具和分享版 | 默认访问 `http://127.0.0.1:4173/` |
| `tests/pwa_smoke.py` | 损坏存档、续玩、离线重载、分享包 | 自己起临时 HTTP 服务 |
| `tests/verify_release.py` | 零依赖发布检查、语法、清单、缓存和单文件依赖 | 发布前必须通过 |
| `README.md` / `PRIVACY.md` / `ASSET_CREDITS.md` | 运行、隐私和素材许可 | 发布渠道变更时同步更新 |

当前核心源码规模（便于 Gemini 估算上下文）：`script.js` 1208 行、`audio-engine.js` 621 行、`challenge-engine.js` 483 行、`style.css` 875 行。

## 4. 第二关引擎：数据契约与难度设计

### 4.1 固定拓扑

`challenge-engine.js` 的常量：

```text
CARD_COUNT = 126
MOTIF_COUNT = 10
MATCH_SIZE = 3
SLOT_CAPACITY = 7
GRID_SIZE = 17
CENTER_LAYER_COUNTS = [9, 9, 9, 9, 8, 8, 7, 7, 6, 5, 4, 3]
RELIEF_LAYER_COUNTS = [4, 3, 3, 2]
SIDE_QUEUE_LENGTH = 15
```

区域分布：

```text
center     84 张，12 层深堆
leftQueue  15 张，单列受限队列
rightQueue 15 张，镜像单列受限队列
relief     12 张，4 层浅层缓冲区
总计       126 张
```

每张牌都发布双向遮挡关系：

```js
card.blockedBy = ['blocker-id', ...];
blocker.blocks = ['blocked-id', ...];
```

挑战局可选判断只看显式关系：

```js
card.blockedBy.every((id) => removedIds.has(id))
```

不要在挑战局重新退回“只按 CSS 几何重叠判断可选”的逻辑；几何位置是视觉表现，DAG 才是规则真相。

### 4.2 生成过程

1. `seedFromDate(date)` 将本地日期和引擎版本哈希成确定性 seed。
2. `createTopology()` 创建四个区域并用相邻层连接遮挡边。
3. `createRandomTopologicalOrder()` 生成一个满足 DAG 的候选见证顺序。
4. `createWitnessMotifs()` 将 10 种图案分成 42 个三连批次；每种图案总数是 12 或 15，均为 3 的倍数。
5. `chooseAssignment()` 最多尝试 64 次，优先满足：开局 0 现成三连、至少 2 组对子、至少 4 种图案。
6. `simulateWitness()` 验证见证路线无道具清空，且槽位峰值为 6（故意留 1 格安全余量）。
7. `measureBoard()` 输出开局、前沿、第三张间隔和路线三连等指标。

### 4.3 对《羊了个羊》的可核验对照

当前设计借鉴的是公开可观察的难度来源，而不是声称复制了未公开算法：

| 难度来源 | 当前实现 |
|---|---|
| 七槽资源压力 | `SLOT_CAPACITY = 7`，见证峰值固定为 6 |
| 深层遮挡 | 中央 12 层 + 显式 `blockedBy/blocks` DAG |
| 区域清理顺序 | 中央深堆、左右长列、浅层 relief 区分开 |
| 延迟第三张 | 图案序列不出现连续 `AAA`；第三张间隔中位数为 2 |
| 第二关难度陡升 | 热身局 18 张，挑战局 126 张、10 图案 |

公开资料只支持“槽位、遮挡、区域顺序和第二关难度跃升”这些方向；没有可靠证据证明某个固定层数、必然死局或隐藏发牌公式，因此不要把玩家传言写成事实。

### 4.4 已测难度指标（365 个日期 seed）

来自求解审计和 `tests/challenge-engine.test.mjs`：

- 365/365：开局可选牌恰好 7 张。
- 365/365：开局现成三连为 0 组。
- 开局干扰对子：178 局为 2 组，187 局为 3 组。
- 365/365：规范见证解无道具通关，槽位峰值为 6。
- 沿见证路线的可选牌数：中位数 7，P90 为 8，最大 9。
- 每局自己的路线前沿最大值：跨日期的 P50 为 10、P90 为 12、最大 15。
- 路线现成三连：跨日期 P50/P90 均为 2，最大 4。
- 第三张牌间隔中位数为 2。
- 简单“优先凑三”机器人：65/36,500 局通关，约 0.1781%。

限制：以上大部分指标沿一条规范见证解统计，不等于所有玩家分支的完整难度分布；当前没有线上玩家遥测，也没有声称复刻《羊了个羊》的内部实现。

### 4.5 引擎公开 API

```js
const board = ChallengeEngine.generateChallenge(seed);
const seed = ChallengeEngine.seedFromDate(new Date());
const available = ChallengeEngine.getAvailableCardIds(board, removedIds);
const witnessResult = ChallengeEngine.simulateWitness(board);
const validation = ChallengeEngine.validateBoard(board);
```

`board` 的稳定字段：

```text
version, seed, cardCount, motifCount, slotCapacity, matchSize,
layout, cards, witness, metrics
```

单牌字段：

```text
id, motifIndex, region, regionLayer, layer, cell,
gridColumn, gridRow, status, blocked, blockedBy, blocks,
jitterX, jitterY, rotation, solutionRank
```

如果新增字段，优先保持向后兼容；如果改变牌的含义、排序或存档结构，必须提升引擎/存档版本并补充迁移或失效策略。

## 5. 音频实现与真机验收

### 5.1 当前实现

`audio-engine.js` 是无外部音频文件的合成引擎：

- 使用 `AudioContext`/`webkitAudioContext`、振荡器、低通滤波器、Gain 和动态压缩器。
- 音乐是 16 步循环旋律，步长约 0.31 秒，提前 0.72 秒调度，140ms 泵浦一次。
- 三条增益总线：`master=0.90`、`music=0.62`、`effects=1.00`。
- 音效类型：`tap`、`match`、`tool`、`shuffle`、`start`、`stage`、`win`、`loss`。
- `index.html` 加载顺序必须让 `AudioEngine` 在 `script.js` 前初始化。

### 5.2 解锁和恢复策略

- 页面初始化时，如果用户上次关闭声音，只调用 `setEnabled(false)`；声音默认开启时不提前创建/恢复 AudioContext。
- `pointerdown`、`touchend`、`keydown` 捕获阶段调用 `unlock({ forceResume: true })`。
- 开始按钮和重新开始按钮在进入游戏前调用 `primeAudio()`。
- iOS 兼容：解锁时播放 1 帧静音 buffer。
- `visibilitychange`、`pagehide` 时停止调度和当前声音；前台、`pageshow`、`focus` 时安排恢复。
- 对 `resume()` 永久 pending 的 WebView 使用 900ms 超时，不阻塞游戏开始。
- 若 AudioContext 状态变为 `interrupted`，120ms 后自动尝试恢复；真实用户手势可强制发起新一次 resume。

### 5.3 交接时必须做的真机矩阵

| 设备/容器 | 操作 | 通过标准 |
|---|---|---|
| iPhone Safari（静音拨片打开和关闭各一次） | 首次点击开始、点牌、消除三连 | 能听到开始音、点击音、消除音和循环音乐；关闭声音后全部停止 |
| iPhone Safari | 锁屏/切到后台 10 秒再回来 | 音乐不持续占用后台；回到前台后能恢复 |
| Android Chrome | 首次点击、刷新、重新开始 | 同上，且无控制台异常 |
| Android 微信内置浏览器 | 首次点击、切后台、回前台、返回系统 | 首次点击有声；恢复后不需要刷新；`resume()` 不阻塞点击 |
| 分享版 `file://` | 首次点击开始 | 页面能玩；若容器限制 Web Audio，应至少不阻塞玩法并可通过声音按钮重试 |

自动化测试只能验证状态和调度节点，不代表人的扬声器听感。任何真机失败都先记录：设备型号、系统、浏览器/微信版本、是否静音、首次手势类型、`AudioEngine.state`，再改代码。

## 6. 存档、日期和兼容性契约

持久化 key：

```text
zlt-stats-v2  成绩统计（plays/wins/streak/bestSeconds/lastWinDate）
zlt-save-v3   当日未完成牌局
zlt-sound-v1  声音开关（on/off）
```

`zlt-save-v3` 的关键字段：

```text
version, date, stageIndex, score, stageStartScore, elapsedSeconds,
cards, pileIds, slotIds, stashIds, history,
hasUsedUndo, hasUsedStash, hasUsedShuffle
```

载入时必须同时满足：JSON 可解析、`version === 3`、日期等于本地 `todayKey()`、关卡索引存在。否则清掉损坏/过期牌局，但不要清掉统计记录。

日期使用浏览器本地时区的 `YYYY-MM-DD`，不是 UTC。若未来要支持跨时区一致的全球每日牌局，必须先明确产品规则，再统一时区并迁移存档。

## 7. PWA、单文件和发布链路

### 7.1 PWA

- `manifest.webmanifest`：`display=standalone`，支持任意方向，主题色 `#d95f45`，图标 192/512。
- `sw.js` 当前缓存名：`zlt-daily-v14`。
- App shell 包含 HTML 依赖的 CSS、两个引擎、主脚本、manifest、背景小图、10 个表情 SVG 和图标。
- 导航请求采用网络优先，失败时回退到缓存的 `index.html`；静态 GET 采用缓存优先并回填。
- 安装阶段 `skipWaiting()`，激活阶段删除旧的 `zlt-daily-*` 缓存并 `clients.claim()`。

### 7.2 单文件分享版

运行：

```powershell
python build.py
```

构建器按 `index.html` 的实际顺序：

1. 删除 preload/manifest（单文件不需要）。
2. 内联 `style.css` 及其 `@import`。
3. 内联 `challenge-engine.js`、`audio-engine.js`、`script.js`。
4. 将本地图片、SVG、音频引用转成 data URL。
5. 写出 `支了个婷_手机分享版.html`。

不要手改分享版；任何源码变更后重新运行构建器并把新文件纳入交付包。

## 8. 运行、测试和故障定位

### 8.1 本地启动

```powershell
Set-Location D:\AI\opencodeFiles\O8.7
python -m http.server 4173
```

打开 <http://127.0.0.1:4173/>。PWA Service Worker 只在 HTTP(S) 环境注册；`file://` 仅适合单文件分享版。

### 8.2 最小验证顺序

```powershell
python build.py
node --test tests/challenge-engine.test.mjs tests/audio-engine.test.mjs
python tests/verify_release.py
```

### 8.3 浏览器回归

首次准备环境：

```powershell
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
```

确保 4173 端口有 HTTP 服务后执行：

```powershell
python tests/browser_smoke.py
python tests/pwa_smoke.py
```

### 8.4 常见故障定位

| 症状 | 先查哪里 | 常见原因 |
|---|---|---|
| 首次点击无声 | `AudioEngine.state`、浏览器控制台、`audio-engine.js` 的 `unlock` | 没有可信手势、页面在 hidden、WebView 的 `resume()` 被挂起 |
| 切后台后无声 | `visibilitychange`/`pagehide`/`pageshow` | 没有恢复 `musicWanted`，或旧调度时间没有重新锚定 |
| 挑战牌不能点 | `blockedBy`、`updateOcclusion`、`removed` 集合 | 把 DAG 规则误改成几何重叠，或存档 ID 不完整 |
| 洗牌后无解 | `shuffleChallengeSafely`、`solutionRank` | 改成普通随机洗牌；必须保留构造式三连顺序 |
| 更新后手机仍是旧版本 | `sw.js` `CACHE_NAME`、HTML 查询参数 | 没升缓存版本，或旧 Service Worker 尚未激活 |
| 分享版报资源错误 | `python build.py`、`verify_release.py` | 新增资源没有被构建器内联，或手改了分享 HTML |
| 文字贴边/横向滚动 | `tokens.css`、`style.css`、浏览器视口 | 新组件绕过 `--safe-inline-start/end`，或新增固定宽度 |

## 9. 不要破坏的约束（Gemini 修改前确认）

### 9.1 玩法/引擎不变量

- 第二关必须保持 126 张，区域计数 `84 + 15 + 15 + 12`。
- 每种图案总数必须是 3 的倍数。
- 遮挡边必须双向对称且无环；见证顺序必须覆盖全部牌。
- 365 个日期 seed 必须全部 `validateBoard().valid === true`。
- 开局目标：7 张可选、0 现成三连、至少 2 组对子。
- 规范见证解必须无道具清空，槽位峰值固定为 6。
- 不要用必败局、隐藏作弊或连续三张同图案来“制造难度”。

### 9.2 前端/发布不变量

- 运行时脚本顺序不能变。
- `SAVE_VERSION` 改变时必须处理旧存档失效，并补测试。
- 修改运行时资源后同时更新 HTML 查询版本、Service Worker 缓存版本，并重建分享版。
- 统计 key 与牌局 key 分离；清理过期牌局不能清空成绩。
- 所有按钮显式 `type="button"`，声音按钮保留 `aria-label`。
- 任何外围文字或工具栏新元素都要经过 safe-area 和 320px 宽度检查。
- 不要把《羊了个羊》的商标、图片、代码或未证实内部算法复制到项目中。

## 10. 已知风险与待办优先级

### P0：转交后立即完成

1. 真机验证音频（iPhone Safari、Android Chrome、Android 微信内置浏览器）。
2. 记录真机 `AudioEngine.state` 和实际听感；若失败，先复现后修改，不要只提高音量。
3. 用目标发布渠道决定最终形态：继续 PWA、做 Android TWA/Capacitor，还是另做 iOS/Android 原生壳。当前没有任何签名包。

### P1：建议在发布前完成

1. 增加“非规范玩家分支”的难度模拟：随机策略、保守策略、优先对子策略、带一次道具策略，输出失败率和槽位峰值分布。
2. 在 365 seed 之外做更多随机 seed 回归，防止日期样本恰好偏乐观。
3. 真机检查字体回退、刘海/圆角屏、横屏窄高屏和系统动态字体。
4. 检查 Service Worker 更新提示或版本显示，避免用户长期停留在旧缓存。
5. 对素材许可证、隐私说明、应用图标和分享文案做目标平台审核清单。

### P2：可以后续迭代

- 难度分层或周末特殊牌局。
- 新道具和可解释的失败提示。
- 更完整的键盘/屏幕阅读器流程。
- 本地可选的匿名导出统计（默认不联网）。

## 11. 建议的下一轮 10 小时计划

| 时间 | 工作 | 交付物 |
|---:|---|---|
| 0–0.5h | Gemini 读取本文件、README、五个核心 JS，跑基线命令 | 基线日志、环境确认 |
| 0.5–2h | iPhone/Android/微信真机音频和生命周期验收 | 设备矩阵与复现记录 |
| 2–4h | 分支策略模拟与 365+ 随机 seed 统计 | 难度分布表，必要时最小引擎补丁 |
| 4–6h | 确定发布形态并补 PWA/原生容器配置 | 可安装包或明确的 PWA 发布包 |
| 6–8h | 三视口视觉、性能、可访问性和离线回归 | 截图、控制台零错误、测试报告 |
| 8–9h | 隐私、素材署名、图标、商店文案和版本号 | 发布资料草案 |
| 9–10h | 重建分享包、最终 smoke、回滚点和交付清单 | 可交付目录 + 最终验收报告 |

若没有原生商店目标或签名权限，4–6h 应改为 PWA 域名部署、安装提示、版本更新策略和真机回归，不要假装生成“已签名原生包”。

## 12. 给 Gemini 的首条任务提示（可直接复制）

```text
你接手的是 D:\AI\opencodeFiles\O8.7 的“支了个婷”项目。

先完整阅读 GEMINI_HANDOFF.md、README.md、index.html、script.js、challenge-engine.js、audio-engine.js、sw.js；不要先重写架构。

先运行：
  node --test tests/challenge-engine.test.mjs tests/audio-engine.test.mjs
  python tests/verify_release.py
  python tests/pwa_smoke.py
  python tests/browser_smoke.py   # 需要 127.0.0.1:4173 服务

你的第一目标是完成 P0 真机音频验收并留下设备/浏览器版本记录；第二目标是补充分支策略和随机 seed 难度统计；第三目标才是决定 PWA 或原生容器发布路径。

修改前先说明假设和验收指标。保持以下不变量：挑战局 126 张、84+15+15+12 区域、显式遮挡 DAG、365 日期 seed 全部可解、开局 7 张可选且 0 现成三连、规范见证槽位峰值 6、存档版本 v3。

每次修改后：
1. 更新相关测试；
2. 若改 HTML/CSS/JS 资源，更新查询版本、sw.js 缓存版本并运行 python build.py；
3. 运行完整四条验证命令；
4. 报告改动文件、测试输出、剩余风险和是否需要我提供真机信息。
```

## 13. 交付检查表

### 源码

- [ ] `index.html`、`script.js`、`challenge-engine.js`、`audio-engine.js` 版本一致。
- [ ] `sw.js` 的 `CACHE_NAME` 已提升并包含所有 app shell 依赖。
- [ ] `SAVE_VERSION` 与存档字段变更策略已记录。
- [ ] 没有把外部网络资源偷偷加入单文件或 PWA。

### 测试

- [ ] Node 牌局/音频测试全通过。
- [ ] 发布检查通过。
- [ ] 浏览器三视口、见证解、道具、分享包通过。
- [ ] PWA 损坏存档、续玩、离线重载通过。
- [ ] 真机音频矩阵完成并附版本信息。

### 发布材料

- [ ] PWA 部署 URL 或原生包目标明确。
- [ ] 隐私说明 URL/文件可访问。
- [ ] CC BY 4.0 表情素材署名保留。
- [ ] 图标、截图、应用描述、版本号和更新说明齐全。
- [ ] 分享版由 `build.py` 生成，未手工编辑。

## 14. 当前可复核文件

- [核心页面](index.html)
- [主控制器](script.js)
- [挑战引擎](challenge-engine.js)
- [音频引擎](audio-engine.js)
- [发布构建器](build.py)
- [Service Worker](sw.js)
- [发布说明](README.md)
- [分享版](支了个婷_手机分享版.html)

最后提醒：当前最有价值的下一步不是继续堆视觉或牌数，而是拿真实设备确认音频、用分支策略统计验证“难但可解”，然后根据实际发布渠道补齐签名和商店材料。
