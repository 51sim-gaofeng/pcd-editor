## v0.1.3 — Camera 接收 + Edit Pick 点选 + 轨迹导出 + 若干 DDS 改进

### 核心新增

#### 相机视频流接收（Camera Receiver）
- 新增 `model/camera_model.py`：UDP GVSP 协议（EI=1 模式）接收 JPEG 帧，支持多包重组、块重组缓冲 TTL 自动回收。
- 新增 Camera 模式 Tab，切换后以 `long-poll /api/camera_frame` 拉流渲染至独立 `<img>` 元素（`<canvas>` 隐藏），FPS / 分辨率实时统计。
- Camera 与 DDS 模式互斥：激活 Camera 自动停止 DDS，反之亦然。
- `POST /api/camera_ensure`：懒启动 UDP 监听；`GET /api/camera_status`：查询帧率、帧 ID、最后接收时间。

#### Edit 模式点云点选（Pick）
- Edit Cloud 面板顶部新增 🔍 Pick 按钮，与 Trajectory 面板共享同一 Pick 状态机，点选后弹出浮窗显示 x / y / z / intensity 等所有原始字段 + 点索引 + 距离。
- 双击点云画布进入 / 退出 Pick 模式（有点云加载时生效，不干扰 Lasso / Eraser / Draw）。
- DDS 实时模式（含暂停状态）下同样可以点选实时点云；三维标记球大小随相机距离自适应缩放。
- Raycaster 阈值改为屏幕空间自适应（≈ 6px 半径），解决实时点云稀疏时点选偏差问题。

#### 轨迹导出（Native Save-As）
- Trajectory Export 按钮在 pywebview 窗口下弹出系统原生「另存为」对话框（`tkinter.filedialog.asksaveasfilename`），用户可自由选路径 / 文件名。
- 浏览器直接访问时自动回退为 `<a>.click()` 浏览器下载，无需判断环境。
- `POST /api/traj_export`：接收 JSON body，调用 tkinter 对话框并写文件，返回 `{ok, file}` 或 `{cancelled}`。

### DDS Live 改进
- P（3D）/ T（Top）/ Front / Left 视角切换在 DDS 实时模式下不再失效；无静态点云时以 80×80×20m 默认范围估算相机位置。
- 点云画布按 `Space` 在 DDS 激活时切换 Pause / Resume（与 ⏸ 按钮等效）；文件播放按键不受影响。

### Bug 修复
- 修复 Camera Stop / DDS 长轮询客户端断连时 `WinError 10053 ConnectionAbortedError` 在终端产生大量 traceback 噪声（`_QuietServer.handle_error` 静默过滤）。
- 修复静态文件及 HTML 页面缺少 `Cache-Control: no-store` 导致 pywebview 复用旧资源的问题。

### 升级说明
- 无新 Python 依赖（Camera 接收仅用标准库 `socket` / `struct`）。
- 默认 UDP 端口仍为 `9870`；Camera 与 DDS 可绑定同一端口，但建议分开以避免竞争。
- 完整变更请参阅 `git log v0.1.2..v0.1.3`。

---

## v0.1.2 — DDS Live 实时点云 + 广播/组播接收 + UI 抛光

### 核心新增
- **DDS Live 实时点云**：通过 UDP 接收 lidar 发布端的点云帧，前端 Web Worker + WebSocket 直推三维场景，端到端延迟从 200ms+ 降到 10–15ms（250k 点稳定 10 fps）。
- **广播 / 组播 / 单播自动识别**：UDP 接收端按 IP 自动判别协议，默认 `255.255.255.255`（广播），同时支持 `239.x.x.x` 组播和具体单播 IP。
  - Windows / Linux 一致行为（广播自动 bind ANY + `SO_BROADCAST`，组播自动 `IP_ADD_MEMBERSHIP`）。
- **接收端 IP 实时回显**：状态栏显示「← from 192.168.1.42:51234」，反映正在广播的源地址。
- **DDS Live / Pause / Stop 三态控制**：Pause 仅冻结渲染、保留 WS 订阅；恢复瞬间显示最新一帧。
- **懒启动**：UDP 监听和 WS 服务只在用户点击 DDS Live 时才启动，启动后零开销。
- **DDS 模式锁**：DDS Live 期间自动锁定文件 / 播放面板，避免误操作。

### 性能优化
- 紧凑 20 字节二进制 WS 帧头（`PCL2 + frame_id + npoints + t_store_ms`），消除 JSON 解析开销。
- WS 服务端 `compression=None` + `TCP_NODELAY` + 8MB 发送缓冲。
- Three.js 单遍渲染：1024 项颜色 LUT、`frustumCulled=false` + 手动 boundingSphere、跨帧携带 z/i 范围。
- 自适应点数预算（Foxglove 风格）：渲染开销超阈值自动降采，恢复后回升。
- 渲染节流留 5% jitter 余量，避免与源帧率临界对齐时漏帧。
- 最大点数滑块上限提升到 100 万。

### UI / 视觉
- 地面网格新增 **Square / Circle 双样式**切换。
- 坐标尺寸标签：每隔可配置距离（默认 10m）在 ±X / ±Y 轴自动标注，背景透明。
- DDS Receiver IP / Port 改为四列等宽网格布局。
- pywebview 窗口支持文本选中复制 + 自定义右键菜单（仅在输入框 / 日志面板触发，不弹 DevTools）。
- "Select a PCD file" 引导文字在加载点云或启动 DDS Live 后自动隐藏。

### 构建
- PyInstaller 打包 `websockets` 包，spec 通过 `collect_all` 完整收集。
- `view/__init__.py` 适配 `_MEIPASS`，one-file 打包后正确解析模板 / 静态资源。
- CI 在 Windows 和 Linux 安装 `websockets` 依赖。

### 协议参考
- **UDP 输入**：`PC2\x00`(4B) + ts_ns(8B) + frame_id(4B) + npoints(4B) + N×16B(x,y,z,intensity float32)，支持分片（`<HHI>` total_slices/slice_idx/total_len）。
- **WS 输出**：`PCL2`(4B) + frame_id u32 + npoints u32 + t_store_ms u64，followed by N×16B float32。

### 升级提示
- 默认 UDP 绑定从 `127.0.0.1` 改为 `255.255.255.255`，原仅监听本机回环的部署需要在 UI 重新填写或加 `--udp-ip 127.0.0.1` 启动参数。
