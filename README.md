# 支了个婷

一款移动端优先的每日三消挑战游戏。牌局按本地日期稳定生成，包含热身关、正式挑战、道具、存档续玩、成绩记录、分享、音乐/音效、震动和离线安装。

## 运行

```powershell
python -m http.server 4173
```

浏览器打开 `http://127.0.0.1:4173/`。通过 HTTP 运行时可安装为 PWA，并在首次加载后离线使用。

## 单文件分享版

```powershell
python build.py
```

命令会生成 `支了个婷_手机分享版.html`，可直接发送并在手机浏览器打开。单文件版保留完整玩法，但不注册 PWA 离线缓存。

构建器会按 `index.html` 中的加载顺序自动内联本地样式、`challenge-engine.js`、`audio-engine.js`、主脚本及其图片/音频资源。新增运行时文件时，仍需把它加入 `index.html` 和 `sw.js` 的 `APP_SHELL`。

## 发布验证

每次准备发布时先运行零依赖检查与引擎测试：

```powershell
python tests/verify_release.py
node --test tests/challenge-engine.test.mjs tests/audio-engine.test.mjs
```

`verify_release.py` 会重建单文件，检查 JavaScript 语法、PWA 清单与图标、离线缓存依赖、版本化存储键、关键可访问性属性，并确认分享版没有遗漏本地资源。

浏览器回归需要 Playwright：

```powershell
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
python tests/browser_smoke.py
python tests/pwa_smoke.py
```

浏览器回归覆盖挑战局、见证解与道具流程，Service Worker 离线重载、损坏存档容错、v3 存档续玩、单文件启动、声音开关，以及 320×568、390×844、844×390 三种移动端视口的边距与溢出。

发布前还应在至少一台 iPhone/Safari 和一台 Android/微信内置浏览器上确认首次点击能解锁音乐、来电或切后台后声音可恢复，并在升级牌局数据结构时同步提升 `zlt-save-v*` 和存档对象的版本号。统计记录应单独迁移，不要随牌局存档一起清空。

## 素材许可

见 [ASSET_CREDITS.md](ASSET_CREDITS.md)。

## 隐私

游戏无账号、无广告、无统计 SDK，记录只保存在当前设备。完整说明见 [PRIVACY.md](PRIVACY.md)。
