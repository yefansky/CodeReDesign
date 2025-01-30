# CodeReDesign

**CodeReDesign** is a VSCode extension designed to work with the DeepSeek API. It helps developers perform code refactoring and redesign more efficiently. By providing file selection, code merging into a unified markdown file, uploading and receiving suggestions via the DeepSeek API, and local application of code changes, CodeReDesign simplifies and streamlines the refactoring process.

**CodeReDesign** 是一个 VSCode 插件，旨在配合 DeepSeek API，帮助开发者更高效地进行代码重构和重新设计。通过提供文件选择、代码合并为统一的 markdown 文件、上传和接收 DeepSeek API 的重构建议，并在本地应用代码变更，CodeReDesign 使得代码重构变得更加简单和流畅。

---

## Features / 功能特性

- **File Selector**: Select multiple source files in the current working directory and merge them into a unified CVB file (markdown format).
- **API Call**: Upload the CVB file to DeepSeek API and get refactoring suggestions.
- **Version Management**: Supports tracking the history of multiple refactor versions. CVB files can be applied locally or rolled back.
- **Multi-language Support**: Supports multiple programming languages including C++, Python, Lua, TypeScript, etc.

- **文件选择器**：支持选择当前工作目录下的多个源文件，并将其合并为统一的 CVB 文件（markdown 格式）。
- **API 调用**：上传 CVB 文件并调用 DeepSeek API，获取重构建议。
- **版本管理**：支持多个次重构的历史记录，CVB 文件可以在本地应用或回滚。
- **多语言支持**：支持 C++、Python、Lua、TypeScript 等多种编程语言。

## Usage / 使用方法

#### Before using, you need to set the DeepSeek API Key
Go to `File -> Preferences -> Settings` (文件 -> 首选项 -> 设置).

Search for `coderedesign`.

Enter your DeepSeek API Key in the **Deep Seek Api Key** field.

#### Commands / 指令：

1. **codeReDesign.generateCvb** (Generate CVB File)
   - Package the code that needs refactoring into CVB format.
   - Select the files you need and press enter.
   - Enter a version name, for example "Initial Version of Multi-process Refactoring".
   - A timestamped CVB file (e.g., `timestamp-versionName.cvb`) will be created in the `.CodeReDesignWorkSpace` directory. This file can be viewed in markdown format.

2. **codeReDesign.uploadCvb** (Upload CVB File)
   - Select a CVB file that has already been created locally and upload it to DeepSeek.
   - Enter a prompt for the refactoring request, such as "Refactor these multi-process codes into multi-threading, and change the inter-process communication standard input-output handles to lock-free queues".
   - DeepSeek will process the request and provide refactoring suggestions. You can see the intermediate steps in the output box.
   - Once done, a new CVB file will be created locally.

3. **codeReDesign.applyCvb** (Apply CVB File)
   - After reviewing the suggestions, you can apply the CVB file by using this command.
   - It will overwrite the local files with the refactored code as described in the CVB file.

---

#### 示例指令：

1. **codeReDesign.generateCvb**（生成 CVB 文件）
   - 打包需要重构的代码为 CVB 格式。
   - 选中你需要的文件，回车。
   - 给这些文件取一个版本名，比如输入 "准备重构多进程-初始版本"。
   - 会在本地 `.CodeReDesignWorkSpace` 目录下生成一个时间戳+版本名的 `.cvb` 文件，可以使用 markdown 格式查看。

2. **codeReDesign.uploadCvb**（上传 CVB 文件）
   - 选择一个本地已经打包好的 CVB 格式文件，上传到 DeepSeek。
   - 输入你希望重构的提示词，比如 "把这些代码里的多进程重构为多线程，注意要把进程间通讯的标准输出输入句柄改为无锁队列"。
   - DeepSeek 会开始帮你重构，你可以在输出框看到中间过程。
   - 输出完毕，会在本地创建一个新的 CVB 格式文件。

3. **codeReDesign.applyCvb**（应用 CVB 文件）
   - 如果查看后觉得没问题，可以用这个指令。
   - 将这个 CVB 格式文件展开并覆盖本地文件。

