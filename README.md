# CodeReDesign

**CodeReDesign** 是一个 VSCode 插件，旨在配合 DeepSeek API，帮助开发者更高效地进行代码重构和重新设计。通过提供文件选择、代码合并文件生成、DeepSeek API 上传和接收、本地代码应用，CodeReDesign 让代码重构变得更加简单和流畅。

---

## 功能特性

- **文件选择器**：支持选择当前工作目录下的多个源文件，打包成一个统一的类 markdown 文件（CVB 格式）。
- **API 调用**：上传 CVB 文件并调用 DeepSeek API，获取重构建议。
- **版本管理**：支持多个次重构的历史记录，CVB 在本地可选应用和回滚。
- **多语言支持**：支持 C++、Python、Lua、TypeScript 等多种编程语言。
- **右键菜单支持**：在资源管理器中，右键点击 `.cvb` 文件时，会显示一个上下文菜单，包含 `applyThisCvb`、`uploadThisCvb` 和 `analyzeThisCvb` 三个选项。
- **CVB 文件视图**：在 VSCode 的侧边栏中，新增了一个 `CVB Actions` 视图，用于显示当前工作区中的所有 `.cvb` 文件，并支持通过点击文件来打开或操作它们。

除了直接通过指令操作，

**你也可以使用图形化的UI:**


![图形化界面演示](/images/guide/readme-guide.png)



**你还可以把本插件当做一个大模型聊天界面**

![聊天界面演示](/images/guide/chat-sample.png)


## 使用方法

#### 使用前需要先设置 DeepSeek API 的 Key
File -> Preferences -> Settings（文件 -> 首选项 -> 设置）

搜索 `coderedesign`

在 `Deep Seek Api Key`（DeepSeek API 密钥）里填写你在 DeepSeek API 获取的 Key。

#### 模型 API 和名称设置
在 `CodeReDesign` 的配置中，你可以设置使用的模型 API 和名称。以下是默认选项和自定义方法：

1. **默认模型配置**：
   - `deepseek-chat`：默认的聊天模型，适用于一般的代码重构和设计任务。
   - `deepseek-reasoner`：推理模型，适用于需要逻辑推理和复杂分析的代码任务。

2. **自定义模型配置**：
   - 如果你需要使用自定义模型，可以在 `CodeReDesign` 的配置中选择 `custom1`、`custom2` ... , 并填写以下信息：
     - **Custom DeepSeek Model Name ?**：自定义模型的名称。
     - **Custom DeepSeek API Base URL ?**：自定义模型的 API 基础 URL。
     - **Custom DeepSeek API Key ?**：自定义模型的 API Key。

   设置方法：
   - 打开 VSCode 的设置界面（File -> Preferences -> Settings）。
   - 搜索 `coderedesign`。
   - 在 `Model Configuration` 中选择 `custom`。
   - 填写 `Custom DeepSeek Model Name` 和 `Custom DeepSeek API Base URL`。

#### 指令：
按下 `ctrl + shift + p` 打开指令菜单（Command Palette），有以下几个指令可用：

1. **codeReDesign.generateCvb**（生成 CVB 文件）
   打包需要重构的代码为 CVB 格式。
   选中你需要的文件，回车。
   给这些文件取一个版本名，比如输入 "准备重构多进程-初始版本"。
   会在本地 `.CodeReDesignWorkSpace` 目录下生成一个时间戳+版本名.cvb 的文件，可以使用 markdown 格式查看。

2. **codeReDesign.uploadCvb**（上传 CVB 文件）
   选择一个本地已经打包好的 CVB 格式文件，上传到 DeepSeek。
   输入你希望重构的提示词，比如 "把这些代码里的多进程重构为多线程，注意要把进程间通讯的标准输出输入句柄改为无锁队列"。
   然后 DeepSeek 就会开始帮你重构，你可以在输出框看到中间过程。
   输出完毕，会在本地创建一个新的 CVB 格式文件。

3. **codeReDesign.applyCvb**（应用 CVB 文件）
   如果查看后觉得没问题，可以用这个指令。
   将这个 CVB 格式文件展开覆盖本地文件。

4. **codeReDesign.stopOperation**（中断处理）
   中断正在执行的 `uploadCvb` 操作。

5. **codeReDesign.analyzeCode**（分析代码）
   选择一个 CVB 文件并输入分析需求，DeepSeek 会分析代码并返回分析结果。

6. **codeReDesign.uploadThisCvb**（上传当前 CVB 文件）
   在资源管理器中右键点击 `.cvb` 文件，选择 `Upload This CVB`，上传当前选中的 CVB 文件并调用 API。

7. **codeReDesign.applyThisCvb**（应用当前 CVB 文件）
   在资源管理器中右键点击 `.cvb` 文件，选择 `Apply This CVB`，将当前选中的 CVB 文件应用到工作区。

8. **codeReDesign.analyzeThisCvb**（分析当前 CVB 文件）
   在资源管理器中右键点击 `.cvb` 文件，选择 `Analyze This CVB`，分析当前选中的 CVB 文件。

---

# CodeReDesign

**CodeReDesign** is a VSCode extension that works with the DeepSeek API to help developers refactor and redesign code more efficiently. By providing file selection, code merging, DeepSeek API upload and download, and local code application, CodeReDesign makes the refactoring process simpler and smoother.

---

## Features

- **File Selector**: Supports selecting multiple source files in the current working directory and packages them into a unified markdown-like file (CVB format).
- **API Calls**: Uploads the CVB file and calls DeepSeek API to get refactoring suggestions.
- **Version Management**: Supports multiple refactoring history records, CVB can be applied and rolled back locally.
- **Multi-language Support**: Supports multiple programming languages like C++, Python, Lua, TypeScript, etc.
- **Right-click Menu Support**: Right-click on a `.cvb` file in the explorer to show a context menu with options to `Apply This CVB`, `Upload This CVB`, and `Analyze This CVB`.
- **CVB File View**: A new `CVB Actions` view in the sidebar displays all `.cvb` files in the current workspace and allows you to open or operate on them by clicking.

## How to Use

#### Before using, set the DeepSeek API Key
File -> Preferences -> Settings

Search for "coderedesign"

In the `Deep Seek Api Key`, enter the key you obtained from the DeepSeek API.

#### Model API and Name Configuration
In the `CodeReDesign` configuration, you can set the model API and name. Here are the default options and how to customize them:

1. **Default Model Configuration**:
   - `deepseek-chat`: The default chat model, suitable for general code refactoring and design tasks.
   - `deepseek-reasoner`: The reasoning model, suitable for code tasks that require logical reasoning and complex analysis.

2. **Custom model configuration**:
   - If you need to use a custom model, you can select `custom1`, `custom2`... in the configuration of `CodeReDesign` and fill in the following information:
     - **Custom DeepSeek model name ?**: The name of the custom model.
     - **Custom DeepSeek API Base URL?**: API base URL of the custom model.
     - **Custom DeepSeek API Key ?**: API Key of the custom model.

   Setup Method:
   - Open VSCode settings (File -> Preferences -> Settings).
   - Search for "coderedesign".
   - Select `custom` in `Model Configuration`.
   - Fill in `Custom DeepSeek Model Name` and `Custom DeepSeek API Base URL`.

#### Commands:
Press `ctrl + shift + p` to open the Command Palette, where the following commands are available:

1. **codeReDesign.generateCvb** (Generate CVB file)
   Package the code you want to refactor into CVB format.
   Select the files you need and press Enter.
   Name the version, such as "Preparing to refactor multi-process to initial version".
   A `.cvb` file with a timestamp and version name will be generated in the `.CodeReDesignWorkSpace` directory, which can be viewed in markdown format.

2. **codeReDesign.uploadCvb** (Upload CVB file)
   Select a locally packaged CVB file and upload it to DeepSeek.
   Enter your refactoring request, such as "Refactor the multi-process code to multi-threading, make sure to change the inter-process communication stdout and stdin handles to lock-free queues".
   DeepSeek will start the refactoring process, and you can see the intermediate steps in the output.
   After the process finishes, a new CVB file will be created locally.

3. **codeReDesign.applyCvb** (Apply CVB file)
   If you review the changes and find them satisfactory, you can use this command.
   It will unpack and overwrite the local files with the changes from the CVB file.

4. **codeReDesign.stopOperation** (Stop Upload CVB)
   Stop the ongoing upload operation.

5. **codeReDesign.analyzeCode** (Analyze Code)
   Select a CVB file and enter your analysis request, DeepSeek will analyze the code and return the results.

6. **codeReDesign.uploadThisCvb** (Upload This CVB)
   Right-click on a `.cvb` file in the explorer and select `Upload This CVB` to upload the selected CVB file and call the API.

7. **codeReDesign.applyThisCvb** (Apply This CVB)
   Right-click on a `.cvb` file in the explorer and select `Apply This CVB` to apply the selected CVB file to the workspace.

8. **codeReDesign.analyzeThisCvb** (Analyze This CVB)
   Right-click on a `.cvb` file in the explorer and select `Analyze This CVB` to analyze the selected CVB file.