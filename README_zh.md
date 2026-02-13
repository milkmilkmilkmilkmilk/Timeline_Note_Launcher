# Timeline Note Launcher

一个类似Twitter时间线的Obsidian插件，用于随机复习你的笔记。以垂直列表形式显示笔记卡片，点击即可打开。

## 功能特性

- **时间线视图**: Twitter风格的垂直信息流，以卡片形式展示笔记
- **多种选择模式**:
  - 随机: 纯随机选择
  - 时间优先: 较旧的笔记更频繁出现
  - SRS（间隔重复系统）: 使用SM-2算法实现最佳复习间隔
- **SRS支持**: 使用Again/Hard/Good/Easy按钮评价卡片，自动安排下次复习。支持撤销评价
- **引用笔记**: 从当前笔记创建包含引用文本的新笔记
- **链接笔记**: 在笔记之间添加链接
- **评论功能**: 直接向笔记添加带时间戳的Callout评论
- **快速笔记**: 直接从时间线创建新笔记
- **过滤栏**: 按文本搜索，按文件类型、标签和日期范围过滤。支持保存和加载过滤预设
- **网格/列表切换**: 切换卡片布局
- **多文件支持**: Markdown、文本、图片、PDF、音频、视频、Excalidraw、Canvas、Jupyter Notebook、Office文件
- **书签集成**: 通过核心书签插件切换卡片的书签状态
- **YAML集成**: 从frontmatter属性读取难度、优先级和日期
- **统计仪表板**: 活动热力图、复习统计和文件类型分布
- **键盘快捷键**: 使用热键高效导航
- **颜色主题**: 多种强调色和UI主题（经典 / Twitter风格）
- **无限滚动**: 滚动加载更多卡片
- **下拉刷新**: 在移动端下拉刷新
- **分屏视图**: 在桌面端以分屏方式打开笔记
- **Frontmatter属性**: 在卡片上显示选定的frontmatter属性

## 安装

### 从社区插件安装（推荐）

1. 打开Obsidian设置
2. 导航到社区插件并禁用安全模式
3. 点击浏览并搜索"Timeline Note Launcher"
4. 安装并启用插件

### 手动安装

1. 从最新版本下载 `main.js`、`manifest.json` 和 `styles.css`
2. 在你的仓库的 `.obsidian/plugins/` 目录中创建 `timeline-note-launcher` 文件夹
3. 将下载的文件复制到该文件夹
4. 重新加载Obsidian并在设置 > 社区插件中启用插件

## 使用方法

### 打开时间线

- 点击左侧功能区的火箭图标
- 或使用命令面板: "Timeline Note Launcher: Open Timeline"

### 复习笔记

1. 根据你选择的模式，卡片会出现在时间线中
2. 点击卡片打开笔记
3. 在SRS模式下，使用难度按钮评价你的记忆程度:
   - **Again**: 10分钟后再次复习
   - **Hard**: 较短间隔
   - **Good**: 正常间隔
   - **Easy**: 带奖励的较长间隔

### 创建引用笔记

1. 在时间线中打开一张卡片
2. 选择你想引用的文本
3. 点击"Add Quote"收集选择
4. 点击"Create Quote Note"生成包含引用的新笔记

### 添加评论

1. 点击卡片上的评论按钮
2. 输入你的评论
3. 评论将作为带时间戳的Callout追加到原笔记中

## 设置

| 设置项 | 说明 |
|-------|------|
| Target Folders | 要包含在时间线中的文件夹（空 = 全部） |
| Exclude Folders | 从时间线中排除的文件夹 |
| Target Tags | 按标签过滤笔记 |
| Selection Mode | 随机 / 时间优先 / SRS |
| View Mode | 列表或网格布局 |
| Media Size | 图片和嵌入的最大高度 |
| Preview Mode | 固定行数 / 一半 / 全文预览 |
| Color Theme | 时间线的强调色 |
| UI Theme | 经典或Twitter风格布局 |
| Show Properties | 在卡片上显示frontmatter属性 |
| Max Cards | 时间线的最大卡片数 |
| Infinite Scroll | 滚动加载更多卡片 |
| Auto Refresh | 时间线自动刷新间隔 |
| YAML Keys | 从frontmatter读取难度、优先级和日期 |
| Quick Note Folder | 快速笔记的保存文件夹 |
| New Cards per Day | SRS模式下每天的新卡片上限 |
| Review Cards per Day | SRS模式下每天的复习上限 |
| Initial Interval | 首次复习间隔（天数） |
| Easy Bonus | Easy评价的倍率 |

完整设置请查看插件设置选项卡。

## 键盘快捷键

| 按键 | 操作 |
|-----|------|
| `j` / `ArrowDown` | 下一张卡片 |
| `k` / `ArrowUp` | 上一张卡片 |
| `Enter` / `o` | 打开选中的笔记 |
| `1` - `4` | 评价卡片（Again/Hard/Good/Easy） |
| `u` | 撤销上次评价 |
| `b` | 切换书签 |
| `c` | 打开评论窗口 |
| `q` | 打开引用笔记窗口 |
| `l` | 打开链接笔记窗口 |
| `r` | 刷新时间线 |
| `Escape` | 取消焦点 |

## 系统要求

- Obsidian v1.0.0 或更高版本

## 已知限制

- 移动端不支持PDF预览（时间线会显示带 Open 按钮的回退卡片）
- 大型仓库可能需要较长的初始加载时间

## 许可证

MIT License - 详情请参阅 [LICENSE](LICENSE)

## 作者

usumi

## 支持

如果你遇到问题或有功能请求，请在[GitHub仓库](https://github.com/usumi/timeline-note-launcher)提交Issue。
