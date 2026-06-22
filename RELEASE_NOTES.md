## v0.5 — 流媒体 Lidar 接收 + 性能优化 + 功能完善

### 核心新增

#### 流媒体 Lidar 接收器（Streaming Lidar Receiver）
- 新增 `model/streaming_model.py`：支持实时 Lidar 点云数据流接收与渲染
  - UDP MSOP（多包协议）接收，自动协议识别与多包重组
  - DIFOP（标定包）处理，支持垂直通道标定参数缓存与复用
  - 实时点云解析与坐标变换，集成至主渲染管线
- 新增 **Streaming Tab**：流媒体模式激活/停止控制
  - 接收器 IP 与端口配置（bind 地址与监听端口）
  - 实时帧率、包统计、延迟指标展示
  - 自动停止其他模式（PCD 播放、Camera），避免接收器冲突
  - 与 DDS Live 互斥：Streaming 激活时自动禁用 DDS

#### 渲染与可视化
- **流媒体点颜色默认为 Intensity**：启用流媒体模式时自动切换为灰度强度显示，贴近原始 lidar 数据语义
- **自适应色彩调整**：保留实时 Brightness / Contrast / Saturation 调整，可快速验证流式数据质量
- 地面网格、坐标标签、视角预设与 DDS Live 保持一致，支持 P（3D）/ T（Top）/ Front / Left 视角

### 性能优化与诊断

#### 吞吐量提升（Streaming Pipeline）
- **多线程 MSOP 接收/解码**：分离网络接收和帧解码为独立线程，消除网络 I/O 阻塞渲染的问题
  - 接收线程维持有界队列（默认 10 帧缓冲），防止内存爆炸
  - 解码线程持续消费队列并推送至渲染
  - 250k+ 点稳定 30+ fps（本地演示）；单播可达 50+ fps
- **矢量化帧解码**：批量转换原始包数据为点云坐标 / 强度，减少 Python 函数调用开销 ~40%
- **DIFOP 垂直 LUT 缓存与去重**：
  - 首次接收 DIFOP 包时解析垂直通道标定参数，转换为方向/距离 LUT
  - 相同标定只计算一次，后续帧直接查表
  - 自动检测标定变化，支持在线重新加载

#### 详细诊断指标
- **Streaming 状态面板** 实时显示：
  - 接收包速率（pps）、解码帧率（fps）、平均延迟（ms）
  - 丢弃/重组统计（用于调试网络问题）
  - CPU 负载（接收线程 / 解码线程占比）
  - 点云尺寸与内存使用估算
- 日志面板自动记录关键事件（启动、标定更新、错误）

### 兼容与配置

#### 默认端口与地址调整
- **HTTP 服务端口**：`8089` → `9089`（与 DDS WebSocket 端口保持一致的递增规律）
- **Camera UDP 端口**：`9870` → `13956`（避免与常见 Lidar 端口冲突）
- **Streaming UDP 端口**：默认 `8000`（可通过 CLI `--streaming-udp-port` 自定义）

#### 兼容性修复
- **Python <3.9 annotation 兼容**：添加 `from __future__ import annotations`，修复 `list[bytes]` / `tuple[...]` 在低版本的 `NameError`
- **WebSocket host 自动映射**：客户端自动将后端返回的 `0.0.0.0` / `::` 映射为实际连接地址，支持跨机部署
- **静态文件缓存**：`/favicon.ico` 返回 204 而非 404，消除浏览器噪声日志

#### 工作流改进
- **模式切换自动停止**：在 PCD 播放 / Camera / Streaming / DDS 模式间切换时，自动停止前一个模式的后端服务
  - 避免多个 UDP 监听器竞争同一端口
  - 清理线程资源，防止泄漏
- **Streaming 速度**：首次启动线程 ~50ms，后续无额外开销

### UI 调整
- **选项卡顺序**：PCD → DDS → Camera → Gaussian → **Streaming**（新增）
- **选项卡说明文本**：每个模式都有简洁引导文案，新用户快速上手

### 升级说明
- **新增依赖**：无（Streaming 仅用标准库 `threading` / `socket` / `struct` / `numpy`）
- **向后兼容**：v0.1.4.1 的所有功能（PCD、DDS Live、Camera、3DGS）保持不变，可无缝升级
- **推荐配置**：
  ```bash
  # 默认启动（Streaming 监听 127.0.0.1:8000）
  python pcd_viewer.py --dir /path/to/pcd
  
  # 自定义 Streaming 接收端口和 IP（远程 Lidar）
  python pcd_viewer.py --dir /path/to/pcd --streaming-udp-port 8001 --streaming-udp-ip 0.0.0.0
  ```

---

## v0.1.4.1 — 3DGS 旋转轴交互修正与可视化反馈

### 核心改进
- 增强 3DGS 模型旋转链路：统一 shader 与排序深度中的旋转/枢轴（pivot）计算，降低视图变化与排序不一致问题。
- 调整 GS 旋转能力：支持按 Roll / Pitch / Yaw（deg）配置模型旋转参数，并与渲染器内部矩阵同步。

### 交互与可用性
- 双击视口设置 GS 旋转枢轴（pivot）流程补强，便于快速指定旋转中心。
- GS 旋转相关 UI 控件联动优化：应用与重置路径更直接，便于反复调参验证。

### 兼容与稳定性
- 修复 3DGS SH 颜色通道映射回归（恢复通道分组布局），缓解道路等区域偏紫色伪影。
- 修正 SH 方向向量计算方向，减少光照方向反转导致的色彩异常。

---

## v0.1.4 — 3DGS 可用性增强 + 排序修正 + 发布流程固化

### 核心新增
- 新增 3DGS 初始提示层（仅文字），进入 GS 模式时显示拖拽 `.ply` 引导。
- GS 面板默认展开 `Gaussian Splatting` 分组，减少首次操作成本。
- 支持 PLY 拖拽上传与自动切换 GS 模式；保留手动文件选择路径。

### 渲染与质量修复
- 修复 worker 计算的 `radii` 未传入渲染器链路，恢复可见性筛选精度。
- 调整 GS 顶点着色器裁剪策略：避免基于中心点的激进 `x/y` 早裁剪，减轻视角后退时边缘进入抖动/缺块。
- 3DGS 文件列表改为“包含目录的自然排序”（目录+文件名共同参与排序）。

### UI 调整
- 移除 GS `Scale` 控件及对应前端交互入口（保留默认渲染尺度）。
- 移除 GS `Max` 控件与即时重载逻辑，默认按后端/解析器上限处理。

### 测试与发布
- 新增 `test_gs_smoke.py`：覆盖 `/api/gaussian_files`、`/api/upload_ply`、垃圾车样例上传回归。
- `README.md` 新增固定发布 SOP，后续版本按同一 8 步流程执行。
- `release.yml` Linux 打包样例时同时包含 `sample/*.ply`（含 `garbage_truck1.ply`）。

---

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
