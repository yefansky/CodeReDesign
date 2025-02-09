# 代码重构助手 VSCode 插件文档

## 概述
代码重构助手是一个 VSCode 插件，旨在帮助开发者更高效地与 DeepSeek API 进行交互，支持多文件代码重构、版本管理、文件对比等功能。通过 CVB（Code Version Backup）文件格式，插件能够将多个代码文件合并为一个文件，并支持上传重构请求、解析 API 反馈、版本回溯等操作。

## 功能列表

### 1. 文件列表生成与排序
将当前工作目录下的代码源文件全选或部分选择，生成一个文件列表。

文件列表根据字典序排序。

### 2. 代码文件合并
将选中的代码文件按顺序合并为一个 CVB 文件。

文件格式如下:
@@@BEGIN_CVB@@@
@@@META@@@
@用户需求:用户输入的重构需求
@时间戳:生成时间
@@@END_META@@@

@@@FILE:文件路径1@@@
文件1内容
@@@END_FILE@@@

@@@FILE:文件路径2@@@
文件2内容
@@@END_FILE@@@
@@@END_CVB@@@

复制

合并后的文件保存在临时工作目录中，命名为 `时间戳.cvb`。

### 3. 重构请求上传
用户输入重构需求（如“将所有鼠标事件处理代码移动到一个文件中”）。

将 CVB 文件内容与用户需求拼接，调用 DeepSeek API 上传请求。

### 4. API 反馈解析
接收 DeepSeek API 返回的字符串，解析出符合 CVB 格式的内容。

提取元数据（如用户需求、时间戳）和文件内容。

将解析后的 CVB 内容保存为新的 `.cvb` 文件。

### 5. 版本管理
提供一个 CVB 文件列表，按时间顺序显示所有生成的 CVB 文件。

支持查看、应用或删除某个 CVB 文件。

### 6. 文件对比
支持对比不同版本的 CVB 文件。

可配置外部 Diff 工具（如 Beyond Compare）进行文件对比。

## 使用场景

### 重构 C++ 工程
按照 MVC 模型重新拆分代码，将外部输入处理代码移动到单独文件中。
梳理代码逻辑，优化不合理的结构。

### 编写新的 VSCode 插件
提供多个模块的代码重构支持，帮助开发者快速整理代码结构。

### 融合 C++ 工程
将旧绘图库（如 xdraw）替换为新封装的 IMGUI 绘图库。

替换旧的外部输入处理逻辑，使用新工程的逻辑。

## 代码结构

### `extension.ts`
插件入口文件，负责注册命令和处理用户交互。
主要功能:

- 生成 CVB 文件。
- 上传 CVB 文件并调用 DeepSeek API。
- 解析 API 返回的 CVB 内容并保存。

### `cvbManager.ts`
负责 CVB 文件的生成与解析。
主要功能:

- 将多个代码文件合并为 CVB 格式。
- 解析 API 返回的字符串，提取 CVB 内容、元数据和文件内容。

### `deepseekApi.ts`
负责与 DeepSeek API 的交互。
主要功能:

- 调用 DeepSeek API，上传 CVB 内容和用户需求。
- 返回 API 的响应内容。

### `fileSelector.ts`
提供文件选择功能，支持用户选择需要重构的代码文件。

## 配置项

### DeepSeek API Key
在 VSCode 设置中配置 `codeReDesign.deepSeekApiKey`，用于调用 DeepSeek API。

### Diff 工具
支持配置外部 Diff 工具（如 Beyond Compare），用于对比不同版本的 CVB 文件。

## 使用示例

### 生成 CVB 文件
1. 打开 VSCode，右键点击工作区，选择 `CodeReDesign: Generate CVB File`。
2. 选择需要重构的代码文件。
3. 输入重构需求（如“将所有鼠标事件处理代码移动到一个文件中”）。
4. 插件会生成一个 `.cvb` 文件，并保存到临时目录。

### 上传 CVB 文件并调用 API
1. 右键点击工作区，选择 `CodeReDesign: Upload CVB and Call API`。
2. 选择需要上传的 `.cvb` 文件。
3. 输入提示词（如“重构代码以提高可读性”）。
4. 插件会调用 DeepSeek API，并将返回的 CVB 内容保存为新文件。

### 查看版本历史
1. 在临时目录中查看所有生成的 `.cvb` 文件。
2. 选择某个文件，查看其元数据和文件内容。
3. 支持应用或删除某个版本。

## CVB 文件格式

### 文件结构
@@@BEGIN_CVB@@@
@@@META@@@
@用户需求:用户输入的重构需求
@时间戳:生成时间
@@@END_META@@@

@@@FILE:文件路径1@@@
文件1内容
@@@END_FILE@@@

@@@FILE:文件路径2@@@
文件2内容
@@@END_FILE@@@
@@@END_CVB@@@

复制

### 示例
@@@BEGIN_CVB@@@
@@@META@@@
@用户需求:将所有鼠标事件处理代码移动到一个文件中
@时间戳:2023-10-01T12:00:00Z
@@@END_META@@@

@@@FILE:src /main.cpp@@@
#include
int main() {
return 0;
}
@@@END_FILE@@@

@@@FILE:src /input_handlers.cpp@@@
void handleMouseEvent() {
// 鼠标事件处理逻辑
}
@@@END_FILE@@@
@@@END_CVB@@@

复制

## 注意事项

### API Key 配置
确保在 VSCode 设置中正确配置 `codeReDesign.deepSeekApiKey`，否则无法调用 DeepSeek API。

### CVB 文件格式
API 返回的字符串必须包含 `@@@BEGIN_CVB@@@` 和 `@@@END_CVB@@@` 标记，否则解析会失败。

### 文件编码
插件支持自动检测和转换文件编码（如 UTF-8、GBK），确保代码内容正确读取。

### 版本管理
每次生成的 CVB 文件都会保存到临时目录，建议定期清理旧版本文件。