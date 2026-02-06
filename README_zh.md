# Timeline Note Launcher

一个类似Twitter时间线的Obsidian插件，用于随机复习你的笔记。以垂直列表形式显示笔记卡片，点击即可打开。

## 功能特性

- **时间线视图**: Twitter风格的垂直信息流，以卡片形式展示笔记
- **多种选择模式**:
  - 随机: 纯随机选择
  - 时间优先: 较旧的笔记更频繁出现
  - SRS（间隔重复系统）: 使用SM-2算法实现最佳复习间隔
- **SRS支持**: 使用Again/Hard/Good/Easy按钮评价卡片，自动安排下次复习
- **引用笔记**: 从当前笔记创建包含引用文本的新笔记
- **评论功能**: 直接向笔记添加带时间戳的Callout评论
- **过滤栏**: 按文本搜索，按文件类型和标签过滤
- **网格/列表切换**: 切换卡片布局
- **多文件支持**: Markdown、图片、PDF、音频、视频
- **统计仪表板**: 活动热力图和复习统计
- **键盘快捷键**: 使用热键高效导航
- **颜色主题**: 多种主题选项

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
| Target Tags | 按标签过滤笔记 |
| Selection Mode | 随机 / 时间优先 / SRS |
| Preview Lines | 每张卡片的预览行数 |
| Auto Refresh | 时间线自动刷新间隔 |
| New Cards per Day | SRS模式下每天的新卡片上限 |
| Daily Review Limit | SRS模式下每天的复习上限 |
| Initial Interval | 首次复习间隔（天数） |
| Easy Bonus | Easy评价的倍率 |
| Theme | 时间线视图的颜色主题 |

## 键盘快捷键

| 按键 | 操作 |
|-----|------|
| `j` / `ArrowDown` | 下一张卡片 |
| `k` / `ArrowUp` | 上一张卡片 |
| `Enter` / `o` | 打开选中的笔记 |
| `r` | 刷新时间线 |
| `g` | 切换网格/列表视图 |
| `1-4` | 评价卡片（SRS模式） |

## 系统要求

- Obsidian v0.15.0 或更高版本

## 已知限制

- 移动端不支持PDF预览（时间线会显示带 Open 按钮的回退卡片）
- 大型仓库可能需要较长的初始加载时间

## 许可证

MIT License - 详情请参阅 [LICENSE](LICENSE)

## 作者

usumi

## 支持

如果你遇到问题或有功能请求，请在[GitHub仓库](https://github.com/usumi/timeline-note-launcher)提交Issue。
