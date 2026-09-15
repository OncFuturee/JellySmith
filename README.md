<p align="center">
  <img src="./icon.png" width="128" height="128" alt="JellySmith 图标" />
</p>

<h1 align="center">JellySmith</h1>

<p align="center">
  面向 Jellyfin 媒体库的本地可视化整理工具<br />
  扫描、分组、匹配、集数映射、预览并安全执行
</p>

<p align="center">
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-35b873.svg" /></a>
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB.svg" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149ECA.svg" />
  <img alt="Platform Windows" src="https://img.shields.io/badge/platform-Windows-4f86f7.svg" />
</p>

JellySmith 用于把下载目录中的电影、剧集和外挂字幕整理成 Jellyfin 易于识别的目录与文件名。应用采用逐步确认的工作流，在真正移动或复制文件前完整展示输出目录结构和每一项文件操作。

> 当前项目处于早期公开版本。首次处理重要媒体库前，请先使用少量文件验证规则并保留备份。

<table>
  <tr>
    <td><img width="750" src="https://github.com/user-attachments/assets/6b113bb0-88ef-4d52-a102-11fa9a0659a0"></td>
    <td><img width="750" src="https://github.com/user-attachments/assets/f0f85cf8-9303-4bc0-bbdd-dd661caa9cf9"></td>
  </tr>
</table>

## 主要功能

- **只读扫描与初筛**：扫描阶段不会修改文件，可按扩展名批量选择进入后续流程的内容。
- **作品分组**：通过本地规则或可选 AI 建议，将同一作品的视频、外挂字幕及相关文件归入同组。
- **字幕关联**：识别常见字幕格式，也可根据内容和文件名判断以 `.txt` 等扩展名保存的字幕，并在方案中与视频一起整理。
- **TMDB 身份确认**：支持电影与剧集、多语言搜索、搜索结果缓存、原始标题/本地化标题选择以及手工录入。
- **表格式集数映射**：即使文件名没有季集编号，也会生成可编辑表格；支持键盘编辑、粘贴 Excel 多行数据、批量偏移、连续重排、缺集和重复集检测。
- **可选 AI 辅助**：AI 可以建议作品分组和集数映射，但不能访问或修改文件；所有结果都需要用户确认。
- **树状方案预览**：执行前直观看到最终目录结构、文件类型、移动/复制方式、冲突与状态。
- **安全执行与审计**：默认禁止覆盖，跨磁盘复制使用 BLAKE3 校验，并保存任务历史、操作结果和软件运行日志。
- **影片详情自动配色**：从海报提取主要色调，在界面显示前生成兼顾对比度的页面配色。
- **中英文与明暗主题**：支持简体中文、英文、深色和亮色界面。

## 工作流程

```text
扫描 → 分组 → TMDB 匹配 → 集数映射 → 预览/执行
```

1. 选择来源目录、电影库目录和剧集库目录。
2. 扫描文件，并按文件类型勾选需要处理的项目。
3. 检查作品分组，必要时手工移动文件或使用 AI 建议。
4. 通过 TMDB 或手工方式确认每个作品的身份。
5. 在表格中检查电影/剧集映射和输出命名。
6. 生成树状文件方案，确认后执行所选操作。

## 运行要求

### 普通使用

- Windows 10 或 Windows 11（64 位）
- Microsoft Edge WebView2 Runtime
- 可选：`ffprobe`，用于后台读取媒体时长等信息
- 可选：TMDB Read Access Token
- 可选：Gemini、硅基流动或 OpenAI 兼容服务的 API Key

没有配置 TMDB 或 AI 时，仍可使用本地扫描、手工分组和手工映射功能。

### 开发环境

- Node.js 20.19+ 或 22.12+
- Rust stable 与 Cargo
- Tauri 在 Windows 上所需的 C++ 构建工具链

## 从源码运行

```bash
git clone https://github.com/OncFuturee/JellySmith.git
cd JellySmith
npm ci
npm run tauri dev
```

## 构建便携版

```bash
npm ci
npm run build:release
```

可执行文件生成在 `src-tauri/target/release/`。项目不生成安装包；复制可执行文件到任意可写目录即可使用。

常用检查命令：

```bash
npm run build
npm test
cd src-tauri
cargo test
cargo check
```

## 绿色软件与数据目录

JellySmith 自身产生的数据全部保存在可执行文件旁的 `data/` 目录：

```text
JellySmith.exe
data/
├─ settings.json          # 界面与行为设置
├─ credentials.json       # TMDB 与 AI API Key
├─ jellysmith.db          # 任务、缓存与执行记录
├─ logs/                  # 软件运行日志
├─ runs/                  # 执行快照
└─ webview/               # WebView 缓存与 LocalStorage
```

- 不使用 AppData、Windows 凭据管理器或注册表保存应用配置。
- 只复制可执行文件到新的空目录，相当于全新安装。
- 连同 `data/` 一起移动，可以保留现有配置和任务。
- API Key 以本地 JSON 文件保存，请将程序目录放在仅可信用户可访问的位置，并且不要把 `data/` 提交到 Git。
- 媒体整理结果会写入任务中由用户明确选择的电影库或剧集库目录。

## 安全边界

- 扫描、分组、匹配和预览阶段不修改媒体文件。
- AI 只接收完成建议所需的结构化文件名信息，不拥有文件系统操作权限。
- 文件移动或复制只能由用户在“预览/执行”页面确认后触发。
- 已存在的目标文件默认不会被覆盖；冲突项不会自动选中。
- 跨磁盘复制会在删除来源前进行内容校验。
- 操作失败会记录原因，并按作品组尝试回滚已完成的操作。

执行前仍建议保留独立备份。任何文件整理工具都无法替代可靠的备份策略。

## 项目结构

```text
src/                    React 界面、任务工作台和前端测试
src-tauri/src/          Rust 命令、数据库、扫描与文件事务
src-tauri/icons/        桌面应用打包图标
public/                 Web 前端静态资源
```

核心技术栈包括 Tauri 2、Rust、React 19、TypeScript、Vite、Ant Design、SQLite 和 react-data-grid。

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交代码前请确保：

1. 变更保持“先预览、后执行”的安全原则。
2. 新增持久化数据只写入便携版 `data/` 目录。
3. 前端通过 `npm run build`，Rust 后端通过 `cargo test` 与 `cargo check`。
4. 不提交 API Key、Token、个人媒体路径、数据库、日志或构建产物。

安全问题请优先使用 GitHub 仓库的 **Security → Report a vulnerability** 私下报告，不要在公开 Issue 中附带密钥、真实媒体路径或个人数据。

## 第三方服务说明

- 本项目使用 TMDB API，但未获得 TMDB 的认可或认证。TMDB 元数据与图片受其各自条款约束。
- Jellyfin 是独立项目；JellySmith 与 Jellyfin 项目没有隶属或官方合作关系。
- AI 服务完全可选，相关请求受用户所选服务商的隐私政策和使用条款约束。

## License

JellySmith 以 [MIT License](./LICENSE) 开源。
