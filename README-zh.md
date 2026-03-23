# GoPeak

[![](https://badge.mcpx.dev?type=server 'MCP Server')](https://modelcontextprotocol.io/introduction)
[![Made with Godot](https://img.shields.io/badge/Made%20with-Godot-478CBF?style=flat&logo=godot%20engine&logoColor=white)](https://godotengine.org)
[![](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white 'Node.js')](https://nodejs.org/en/download/)
[![](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white 'TypeScript')](https://www.typescriptlang.org/)
[![npm](https://img.shields.io/npm/v/gopeak?style=flat&logo=npm&logoColor=white 'npm')](https://www.npmjs.com/package/gopeak)

[![](https://img.shields.io/github/last-commit/HaD0Yun/Gopeak-godot-mcp 'Last Commit')](https://github.com/HaD0Yun/Gopeak-godot-mcp/commits/main)
[![](https://img.shields.io/github/stars/HaD0Yun/Gopeak-godot-mcp 'Stars')](https://github.com/HaD0Yun/Gopeak-godot-mcp/stargazers)
[![](https://img.shields.io/github/forks/HaD0Yun/Gopeak-godot-mcp 'Forks')](https://github.com/HaD0Yun/Gopeak-godot-mcp/network/members)
[![](https://img.shields.io/badge/License-MIT-red.svg 'MIT License')](https://opensource.org/licenses/MIT)

🌐 **选择语言**: [English](README.md) | [한국어](README-ko.md) | **简体中文** | [日本語](README-ja.md) | [Deutsch](README-de.md) | [Português](README-pt_BR.md)

```text
                           (((((((             (((((((                          
                        (((((((((((           (((((((((((                      
                        (((((((((((((       (((((((((((((                       
                        (((((((((((((((((((((((((((((((((                       
                        (((((((((((((((((((((((((((((((((                       
         (((((      (((((((((((((((((((((((((((((((((((((((((      (((((        
       (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((      
     ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((    
    ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((    
      (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((     
        (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((       
         (((((((((((@@@@@@@(((((((((((((((((((((((((((@@@@@@@(((((((((((        
         (((((((((@@@@,,,,,@@@(((((((((((((((((((((@@@,,,,,@@@@(((((((((        
         ((((((((@@@,,,,,,,,,@@(((((((@@@@@(((((((@@,,,,,,,,,@@@((((((((        
         ((((((((@@@,,,,,,,,,@@(((((((@@@@@(((((((@@,,,,,,,,,@@@((((((((        
         (((((((((@@@,,,,,,,@@((((((((@@@@@((((((((@@,,,,,,,@@@(((((((((        
         ((((((((((((@@@@@@(((((((((((@@@@@(((((((((((@@@@@@((((((((((((        
         (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((        
         (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((        
         @@@@@@@@@@@@@((((((((((((@@@@@@@@@@@@@((((((((((((@@@@@@@@@@@@@        
         ((((((((( @@@(((((((((((@@(((((((((((@@(((((((((((@@@ (((((((((        
         (((((((((( @@((((((((((@@@(((((((((((@@@((((((((((@@ ((((((((((        
          (((((((((((@@@@@@@@@@@@@@(((((((((((@@@@@@@@@@@@@@(((((((((((         
           (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((          
              (((((((((((((((((((((((((((((((((((((((((((((((((((((             
                 (((((((((((((((((((((((((((((((((((((((((((((((                
                        (((((((((((((((((((((((((((((((((                       
                                                                                


        /$$$$$$             /$$$$$$$                      /$$      
       /$$__  $$           | $$__  $$                    | $$      
      | $$  \__/  /$$$$$$ | $$  \ $$ /$$$$$$   /$$$$$$$ | $$  /$$/
      | $$ /$$$$//$$__  $$| $$$$$$$//$$__  $$ |____  $$ | $$ /$$/ 
      | $$|_  $$| $$  \ $$| $$____/| $$$$$$$$  /$$$$$$$ | $$$$$/  
      | $$  \ $$| $$  | $$| $$     | $$_____/ /$$__  $$ | $$  $$  
      |  $$$$$$/|  $$$$$$/| $$     |  $$$$$$ |  $$$$$$$ | $$\  $$ 
       \______/  \______/ |__/      \______/  \_______/ |__/ \__/ 
```

**最全面的 Godot 引擎 Model Context Protocol (MCP) 服务器 — 让 AI 助手能够以前所未有的深度和精准度构建、修改和调试 Godot 游戏。**

> **全新自动重载功能！** 通过 MCP 外部修改场景和脚本时，Godot 编辑器会自动刷新。

---

## 为什么选择 GoPeak？

### 🚀 革新您的游戏开发工作流程

GoPeak 不仅仅是一个工具 — 它是 AI 助手与游戏引擎交互方式的**范式转变**：

#### 1. **真正理解 Godot 的 AI**

传统 AI 助手可以编写 GDScript，但本质上是在盲目操作。它们根据训练数据生成代码，希望它能正常工作。**GoPeak 改变了一切：**

- **实时反馈循环**：当您要求"运行项目并显示错误"时，AI 会实际运行您的项目，捕获输出，并精确看到出了什么问题
- **上下文感知辅助**：AI 可以检查您的实际场景树，理解节点层次结构，并根据您真实的项目结构提供建议
- **建议前先验证**：在建议使用资源之前，AI 可以验证该资源是否存在于您的项目中

#### 2. **110+ 工具配合动态 ClassDB 反射**

GoPeak 不是为每个 Godot 类硬编码工具，而是提供适用于**任意** ClassDB 类的**通用工具**（`add_node`、`create_resource`），以及让 AI 动态发现类、属性和方法的 **ClassDB 反射工具**。

| 类别 | 能做什么 | 工具 |
|------|---------|------|
| **场景管理** | 通过编程构建完整场景树 | `create_scene`, `add_node`, `delete_node`, `duplicate_node`, `reparent_node`, `list_scene_nodes`, `get_node_properties`, `set_node_properties` |
| **ClassDB 反射** | 动态发现 Godot 类、属性、方法、信号 | `query_classes`, `query_class_info`, `inspect_inheritance` |
| **GDScript 操作** | 精准编写和修改脚本 | `create_script`, `modify_script`, `get_script_info` |
| **资源管理** | 创建任意资源类型，修改现有资源 | `create_resource`, `modify_resource`, `create_material`, `create_shader` |
| **动画系统** | 构建动画和状态机 | `create_animation`, `add_animation_track`, `create_animation_tree`, `add_animation_state`, `connect_animation_states` |
| **2D 瓦片系统** | 创建瓦片集并填充瓦片地图 | `create_tileset`, `set_tilemap_cells` |
| **信号管理** | 连接游戏事件系统 | `connect_signal`, `disconnect_signal`, `list_connections` |
| **项目配置** | 管理设置、自动加载和输入 | `get_project_setting`, `set_project_setting`, `add_autoload`, `add_input_action` |
| **开发者体验** | 分析、调试和维护项目 | `get_dependencies`, `find_resource_usages`, `parse_error_log`, `get_project_health`, `search_project` |
| **运行时调试** | 检查和修改运行中的游戏 | `inspect_runtime_tree`, `set_runtime_property`, `call_runtime_method`, `get_runtime_metrics` |
| **截图捕获** | 从运行中的游戏捕获视口截图 | `capture_screenshot`, `capture_viewport` |
| **输入注入** | 模拟键盘、鼠标和动作输入 | `inject_action`, `inject_key`, `inject_mouse_click`, `inject_mouse_motion` |
| **GDScript LSP** | 通过 Godot 内置语言服务器进行诊断、补全、悬停和符号 | `lsp_get_diagnostics`, `lsp_get_completions`, `lsp_get_hover`, `lsp_get_symbols` |
| **调试适配器 (DAP)** | 断点、步进、堆栈跟踪和调试输出捕获 | `dap_get_output`, `dap_set_breakpoint`, `dap_continue`, `dap_step_over`, `dap_get_stack_trace` |
| **MCP 资源** | 通过 `godot://` URI 访问项目文件 | `godot://project/info`, `godot://scene/{path}`, `godot://script/{path}` |
| **音频系统** | 创建音频总线，配置效果 | `create_audio_bus`, `get_audio_buses`, `set_audio_bus_effect`, `set_audio_bus_volume` |
| **导航** | AI 寻路设置 | `create_navigation_region`, `create_navigation_agent` |
| **UI/主题** | 使用着色器创建和应用自定义主题 | `set_theme_color`, `set_theme_font_size`, `apply_theme_shader` |
| **资源库** | 从多个来源搜索和下载 CC0 资源 | `search_assets`, `fetch_asset`, `list_asset_providers` |
| **自动重载** | 外部更改时即时刷新编辑器 | 内置编辑器插件 |

> **设计哲学**：与其提供 110+ 个专用工具（如 `create_camera`、`create_light`、`create_physics_material`），GoPeak 使用通用的 `add_node` 和 `create_resource` 工具，适用于任意 Godot 类。AI 使用 `query_classes` 发现可用类型，使用 `query_class_info` 了解其属性 — 就像开发者使用 Godot 文档一样。

#### 动态工具组（compact 模式）

在 `compact` 配置文件中，默认显示 33 个核心工具，另有 78 个工具分为 **22 个组**，按需自动激活：

| 组名 | 工具数 | 说明 |
|---|---|---|
| `scene_advanced` | 3 | 节点复制、重新父级化、精灵加载 |
| `uid` | 2 | 资源 UID 管理 |
| `import_export` | 5 | 导入管线、重新导入、项目验证 |
| `autoload` | 4 | 自动加载单例、主场景 |
| `signal` | 2 | 信号断开、连接列表 |
| `runtime` | 4 | 实时场景检查、运行时属性、性能指标 |
| `resource` | 4 | 创建/修改材质、着色器、资源 |
| `animation` | 5 | 动画、轨道、状态机 |
| `plugin` | 3 | 编辑器插件管理 |
| `input` | 1 | 输入动作映射 |
| `tilemap` | 2 | TileSet 和 TileMap 绘制 |
| `audio` | 4 | 音频总线、效果、音量 |
| `navigation` | 2 | 导航区域/代理 |
| `theme_ui` | 3 | 主题颜色、字体大小、着色器 |
| `asset_store` | 3 | CC0 资源搜索/下载 |
| `testing` | 6 | 截图、视口捕获、输入注入 |
| `dx_tools` | 4 | 错误日志、项目健康、使用搜索 |
| `intent_tracking` | 9 | 意图捕获、决策日志、交接 |
| `class_advanced` | 1 | 类继承检查 |
| `lsp` | 3 | GDScript 补全、悬停、符号 |
| `dap` | 6 | 断点、步进、堆栈跟踪 |
| `version_gate` | 2 | 版本验证、补丁确认 |

**使用方式：**
1. **目录自动激活**：使用 `tool.catalog` 搜索时，匹配的工具组会自动激活。
2. **手动激活**：使用 `tool.groups` 直接激活/停用工具组。
3. **重置**：使用 `tool.groups` 的 `reset` 操作停用所有组。

#### 3. **自动重载实现无缝编辑器集成**

内置的**自动重载插件**消除了外部编辑的摩擦：

- **无需手动刷新**：MCP 修改场景或脚本时，Godot 编辑器自动重载
- **1秒检测**：轻量级轮询，性能影响可忽略不计（~0.01ms/秒）
- **智能监控**：监控打开的场景及其附加的脚本
- **零配置**：只需启用插件即可

```
MCP 修改文件 → 自动重载检测 → 编辑器重载 → 即时看到结果
```

#### 4. **告别复制粘贴调试循环**

**使用 GoPeak 之前：**
1. 向 AI 请求代码
2. 将代码复制到项目中
3. 运行项目，遇到错误
4. 将错误复制回 AI
5. 获取修复，粘贴
6. 重复 10+ 次

**使用 GoPeak 之后：**
1. "创建一个有血量、移动和跳跃的玩家角色"
2. AI 创建场景、编写脚本、添加节点、连接信号并测试
3. 完成。

AI 不只是编写代码 — 它**端到端实现功能**。

#### 5. **类型安全、抗错误的操作**

GoPeak 的每个操作包括：

- **路径验证**：防止无效文件操作
- **类型序列化**：正确处理 Vector2、Vector3、Color、Transform 和所有 Godot 类型
- **错误恢复**：带有修复建议的有意义的错误消息
- **原子操作**：变更要么全部应用，要么完全不应用

#### 6. **项目健康智能**

`get_project_health` 工具提供项目的综合分析：

```json
{
  "score": 85,
  "grade": "B",
  "checks": {
    "structure": { "passed": true },
    "resources": { "issues": ["3 个纹理需要重新导入"] },
    "scripts": { "issues": ["发现 5 个 TODO 注释"] },
    "config": { "passed": true }
  },
  "recommendations": [
    "为目标平台配置导出预设",
    "发布前检查并解决 TODO 项目"
  ]
}
```

#### 7. **依赖分析与循环引用检测**

`get_dependencies` 工具：

- 映射项目中的每个资源依赖关系
- 在导致运行时错误之前检测循环引用
- 显示任意资源的完整依赖链

```
PlayerScene.tscn
├── PlayerScript.gd
│   └── WeaponBase.gd
│       └── ⚠️ 循环引用: PlayerScript.gd
└── PlayerSprite.png
```

#### 8. **实时运行时调试（可选插件）**

安装内置的 `godot_mcp_runtime` 插件后可解锁：

- **实时场景树检查**：游戏运行时查看实际节点树
- **热属性修改**：无需重启即可实时更改值
- **远程方法调用**：在运行中的游戏中触发函数
- **性能监控**：跟踪 FPS、内存、绘制调用等

### 💡 实际使用场景

#### **快速原型制作**
```
"创建一个玩家可以移动、跳跃和收集金币的基础平台游戏"
```
AI 创建场景、脚本、节点、信号和输入动作 — 几分钟内完成可玩原型。

#### **大规模重构**
```
"找到所有使用旧 PlayerData 资源的地方并更新为新的 PlayerStats"
```
搜索整个项目，识别每个引用，并进行一致的更改。

#### **调试复杂问题**
```
"我的玩家一直穿过地板。检查我的碰撞设置并告诉我问题所在"
```
检查节点属性，分析场景结构，识别配置问题。

#### **学习 Godot**
```
"通过创建一个点击按钮后改变标签文字的示例来展示信号如何工作"
```
AI 在实际项目中构建工作示例，而不只是解释。

#### **维护大型项目**
```
"对我的项目进行健康检查并告诉我需要注意什么"
```
获取关于项目结构、未使用资源和潜在问题的可操作洞察。

---

## 功能特性

### 核心功能
- **启动 Godot 编辑器**：为特定项目打开 Godot 编辑器
- **运行 Godot 项目**：在调试模式下执行 Godot 项目
- **捕获调试输出**：获取控制台输出和错误消息
- **控制执行**：以编程方式启动和停止 Godot 项目
- **获取 Godot 版本**：获取已安装的 Godot 版本
- **列出 Godot 项目**：在指定目录中查找 Godot 项目
- **项目分析**：获取项目结构的详细信息

### 场景管理
- 使用指定根节点类型创建新场景
- 添加、删除、复制和重新父级化节点
- 使用类型安全序列化设置节点属性
- 列出完整层次结构的场景树
- 将精灵和纹理加载到 Sprite2D 节点
- 将 3D 场景导出为 GridMap 的 MeshLibrary 资源

### GDScript 操作
- **创建脚本**：使用模板生成新的 GDScript 文件（singleton、state_machine、component、resource）
- **修改脚本**：向现有脚本添加函数、变量和信号
- **分析脚本**：获取脚本结构、依赖关系和导出的详细信息

### 信号与连接管理
- 连接场景中节点之间的信号
- 断开信号连接
- 列出场景中的所有信号连接

### ClassDB 反射（新功能！）
- **查询类**：通过名称、类别（node、node2d、node3d、control、resource 等）和可实例化性过滤发现可用的 Godot 类
- **查询类信息**：获取任意类的详细方法、属性、信号和枚举
- **检查继承**：探索类层次结构 — 祖先、子类和所有后代

### 资源管理
- **创建资源**：将任意资源类型生成为 .tres 文件（替代专用的 create_* 工具）
- **修改资源**：更新现有 .tres/.res 文件的属性
- **创建材质**：StandardMaterial3D、ShaderMaterial、CanvasItemMaterial、ParticleProcessMaterial
- **创建着色器**：带模板的 canvas_item、spatial、particles、sky、fog 着色器

### 动画系统
- 在 AnimationPlayer 节点中创建新动画
- 向动画添加属性和方法轨道
- 插入带有正确值序列化的关键帧

### 2D 瓦片系统
- 使用图集纹理源创建 TileSet 资源
- 以编程方式设置 TileMap 格子

### 导入/导出流程
- 获取资源的导入状态和选项
- 修改导入设置并触发重新导入
- 列出导出预设并验证项目以供导出
- 使用 Godot CLI 导出项目

### 项目配置
- 获取和设置项目设置
- 管理自动加载单例（添加、删除、列出）
- 设置主场景
- 添加带有键、鼠标和手柄事件的输入动作

### 插件管理
- 列出已安装的插件及其状态
- 启用和禁用插件

### 开发者体验
- **依赖分析**：获取带有循环引用检测的资源依赖图
- **资源使用查找器**：在整个项目中查找资源的所有使用
- **错误日志解析器**：解析带有建议的 Godot 错误日志
- **项目健康检查**：带评分的综合项目分析
- **项目搜索**：在所有项目文件中搜索文本/模式

---

## 系统要求

- 系统已安装 [Godot Engine 4.x](https://godotengine.org/download)
- Node.js 18+ 和 npm
- 支持 MCP 的 AI 助手（Claude Desktop、Cline、Cursor、OpenCode 等）

---

## 安装与配置

### 🚀 一键安装（推荐）

**Linux / macOS**
```bash
curl -sL https://raw.githubusercontent.com/HaD0Yun/Gopeak-godot-mcp/main/install.sh | bash
```

此脚本将：
- ✅ 检查前置条件（Git、Node.js 18+、npm）
- ✅ 将仓库克隆到 `~/.local/share/godot-mcp`
- ✅ 自动安装依赖并构建
- ✅ 自动检测 Godot 安装
- ✅ 显示 AI 助手的配置说明

---

### 通过 npm 安装（最快）

```bash
npx gopeak
```

或全局安装：
```bash
npm install -g gopeak
gopeak
```

---

### 手动安装

#### 第一步：安装和构建

```bash
git clone https://github.com/HaD0Yun/Gopeak-godot-mcp.git
cd godot-mcp
npm install
npm run build
```

#### 第二步：配置 AI 助手

**Cline (VS Code)：**
```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/absolute/path/to/godot-mcp/build/index.js"],
      "env": {
        "GODOT_PATH": "/path/to/godot",
        "DEBUG": "true"
      },
      "disabled": false
    }
  }
}
```

**Claude Desktop：**
```json
{
  "mcpServers": {
    "godot": {
      "command": "node",
      "args": ["/absolute/path/to/godot-mcp/build/index.js"],
      "env": {
        "GODOT_PATH": "/path/to/godot"
      }
    }
  }
}
```

**OpenCode：**
```json
{
  "mcp": {
    "godot": {
      "type": "local",
      "command": ["node", "/absolute/path/to/godot-mcp/build/index.js"],
      "enabled": true,
      "environment": {
        "GODOT_PATH": "/path/to/godot"
      }
    }
  }
}
```

### 第三步：环境变量

| 变量 | 描述 |
|------|------|
| `GODOT_PATH` | Godot 可执行文件路径（未设置时自动检测） |
| `DEBUG` | 设置为 "true" 以启用详细日志 |

---

## 示例提示

配置完成后，您可以使用自然语言控制 Godot：

### 场景构建
```
"创建一个名为 Player 的 CharacterBody2D 根节点新场景"
"向我的 Player 场景添加 Sprite2D 和 CollisionShape2D"
"复制 Enemy 节点并命名为 Enemy2"
```

### 脚本操作
```
"为我的玩家创建带有移动和跳跃功能的 GDScript"
"向我的玩家脚本添加一个发送 health_changed 信号的 take_damage 函数"
"显示我的 PlayerController 脚本结构"
```

### 资源管理
```
"为我的敌人创建红色 StandardMaterial3D"
"创建带有溶解效果的 canvas_item 着色器"
"从 tilemap_atlas.png 生成 16x16 瓦片的 TileSet"
```

### 项目分析
```
"检查我的项目健康状况并显示问题"
"找到所有使用 PlayerData 资源的文件"
"显示我主场景的依赖图"
```

### 调试
```
"运行我的项目并显示错误"
"解析我的 Godot 错误日志并提供修复建议"
"检查我运行中游戏的场景树"
```

---

## 内置插件

### 自动重载插件（推荐）

**MCP 工作流程的必备工具** - 外部修改时自动重载场景和脚本。

**Linux / macOS：**
```bash
# 在您的 Godot 项目文件夹中运行
curl -sL https://raw.githubusercontent.com/HaD0Yun/Gopeak-godot-mcp/main/install-addon.sh | bash
```

**手动安装：**
1. 将 `build/addon/auto_reload` 复制到项目的 `addons/` 文件夹
2. 在 Godot 中打开项目
3. 前往 **Project > Project Settings > Plugins**
4. 启用 "Godot MCP Auto Reload"

**⚠️ 警告**：如果您同时在编辑器中和外部修改场景，编辑器中的更改将会丢失。

---

## 架构

GoPeak 使用混合架构：

1. **直接 CLI 命令**：简单操作使用 Godot 内置 CLI
2. **捆绑 GDScript**：复杂操作使用带有 ClassDB 反射的综合 `godot_operations.gd` 脚本
3. **运行时插件**：用于实时调试、截图捕获和输入注入的 TCP 服务器（端口 7777）
4. **Godot LSP 集成**：连接到 Godot 编辑器的语言服务器（端口 6005）进行 GDScript 诊断
5. **Godot DAP 集成**：连接到 Godot 的调试适配器（端口 6006）进行断点和步进
6. **MCP 资源**：用于直接项目文件访问的 `godot://` URI 协议

---

## 故障排除

| 问题 | 解决方案 |
|------|---------|
| 找不到 Godot | 设置 `GODOT_PATH` 环境变量 |
| 连接问题 | 重启您的 AI 助手 |
| 无效的项目路径 | 确保路径包含 `project.godot` |
| 构建错误 | 运行 `npm install` 安装依赖 |
| 运行时工具不工作 | 在项目中安装并启用插件 |

---

## 贡献

欢迎贡献！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 指南。

---

## 许可证

MIT 许可证 - 详情请参阅 [LICENSE](LICENSE)。

---

## 统计数据

- **110+ 工具** — 涵盖场景管理、脚本、资源、动画、配置、调试、截图、输入注入、LSP、DAP 和资源管理的综合工具
- **MCP 资源** — 用于直接项目文件访问的 `godot://` URI 协议
- **GDScript LSP** — 通过 Godot 语言服务器提供实时诊断、补全、悬停和符号
- **调试适配器 (DAP)** — 断点、步进、堆栈跟踪和控制台输出捕获
- **截图捕获** — 通过运行时插件从运行中的游戏捕获视口
- **输入注入** — 用于自动化测试的键盘、鼠标和动作模拟
- **ClassDB 反射** — AI 动态发现 Godot 类、属性和方法，而非依赖硬编码工具定义
- **20,000+ 行** TypeScript 和 GDScript
- **约 85% 覆盖率** 的 Godot Engine 功能
- **Godot 4.x** 完全支持（包括 4.4+ UID 功能）
- **自动重载**插件实现无缝 MCP 集成
- **多源资源库** — 来自 Poly Haven、AmbientCG 和 Kenney 的 CC0 资源
- **npm 包** — 通过 `npx gopeak` 或 `npm install -g gopeak` 安装

---

## 致谢

- 原始 MCP 服务器由 [Coding-Solo](https://github.com/Coding-Solo/godot-mcp) 创建
- 自动重载插件和统一包由 [HaD0Yun](https://github.com/HaD0Yun) 开发
