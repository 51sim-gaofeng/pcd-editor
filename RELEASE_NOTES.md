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
