# CodeReDesign

**CodeReDesign** 是一个 VSCode 插件，旨在配合DeepSeek API，帮助开发者更高效地进行代码重构和重新设计。通过提供文件选择、代码合并文件生成、DeepSeek API 上传和接收、本地代码应用，CodeReDesign 让代码重构变得更加简单和流畅。

---

## 功能特性

- **文件选择器**：支持选择当前工作目录下的多个源文件，打包成一个统一的类markdown文件（CVB格式）。
- **API 调用**：上传 CVB 文件并调用 DeepSeek API，获取重构建议。
- **版本管理**：支持多个次重构的历史记录， CVB 在本地可选应用和回滚。
- **多语言支持**：支持 C++、Python、Lua、TypeScript 等多种编程语言。

## 使用方法

#### 使用前需要先设置DeepSeek API 的Key
File -> Preferences -> Settings（文件 -> 首选项 -> 设置）

搜索 coderedesign

在 Deep Seek Api Key（DeepSeek API 密钥）里填写你在 DeepSeek API 获取的 Key

#### 指令：
ctrl + shift + p 打开指令菜单（Command Palette），有以下几个指令可用：

1. **codeReDesign.generateCvb**（生成 CVB 文件）
   打包需要重构的代码为 CVB 格式
   选中你需要的文件，回车
   给这些文件取一个版本名，比如输入 "准备重构多进程-初始版本"
   会在本地 `.CodeReDesignWorkSpace` 目录下生成一个时间戳+版本名.cvb 的文件，可以使用 markdown 格式查看

2. **codeReDesign.uploadCvb**（上传 CVB 文件）
   选择一个本地已经打包好的 CVB 格式文件，上传到 DeepSeek
   输入你希望重构的提示词，比如 "把这些代码里的多进程重构为多线程，注意要把进程间通讯的标准输出输入句柄改为无锁队列"
   然后 DeepSeek 就会开始帮你重构，你可以在输出框看到中间过程
   输出完毕，会在本地创建一个新的 CVB 格式文件

3. **codeReDesign.applyCvb**（应用 CVB 文件）
   如果查看后觉得没问题，可以用这个指令
   将这个 CVB 格式文件展开覆盖本地文件


---

# CodeReDesign

**CodeReDesign** is a VSCode extension that works with the DeepSeek API to help developers refactor and redesign code more efficiently. By providing file selection, code merging, DeepSeek API upload and download, and local code application, CodeReDesign makes the refactoring process simpler and smoother.

---

## Features

- **File Selector**: Supports selecting multiple source files in the current working directory and packages them into a unified markdown-like file (CVB format).
- **API Calls**: Uploads the CVB file and calls DeepSeek API to get refactoring suggestions.
- **Version Management**: Supports multiple refactoring history records, CVB can be applied and rolled back locally.
- **Multi-language Support**: Supports multiple programming languages like C++, Python, Lua, TypeScript, etc.

## How to Use

#### Before using, set the DeepSeek API Key
File -> Preferences -> Settings

Search for "coderedesign"

In the Deep Seek Api Key, enter the key you obtained from the DeepSeek API.

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
