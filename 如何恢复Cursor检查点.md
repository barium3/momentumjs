# 如何手动调取 Cursor 检查点中的代码

## 📍 Cursor 历史记录位置

### macOS
```
~/Library/Application Support/Cursor/User/History/
```

### Windows
```
%APPDATA%\Cursor\User\History\
```

### Linux
```
~/.config/Cursor/User/History/
```

## 🔍 查找特定文件的历史记录

### 方法 1：使用命令行查找

```bash
# 1. 查找包含特定文件的 entries.json
find ~/Library/Application\ Support/Cursor/User/History -name "entries.json" -exec grep -l "core.js" {} \;

# 2. 查看该目录下的所有历史文件
ls -la ~/Library/Application\ Support/Cursor/User/History/<目录名>/

# 3. 读取 entries.json 查看历史版本列表
cat ~/Library/Application\ Support/Cursor/User/History/<目录名>/entries.json
```

### 方法 2：手动浏览

1. 打开 Finder（macOS）或文件管理器
2. 按 `Cmd+Shift+G`（macOS）或 `Win+R`（Windows）打开"前往文件夹"
3. 输入路径：`~/Library/Application Support/Cursor/User/History/`
4. 浏览各个目录，查找 `entries.json` 文件
5. 打开 `entries.json`，查找您需要的文件名
6. 在同一个目录中找到对应的 `.js` 文件（文件名是 entries.json 中列出的 ID）

## 📝 entries.json 格式说明

```json
{
  "version": 1,
  "resource": "file:///完整路径/文件名",
  "entries": [
    {"id": "文件ID.js", "timestamp": 时间戳},
    {"id": "文件ID.js", "timestamp": 时间戳, "source": "undoRedo.source"}
  ]
}
```

- `id`: 历史文件的文件名
- `timestamp`: 保存时间（毫秒时间戳）
- `source`: 来源（可选）

## 🔄 恢复文件步骤

### 步骤 1：找到最新的历史记录

```bash
# 查找包含您文件的所有历史记录目录
find ~/Library/Application\ Support/Cursor/User/History -name "entries.json" -exec grep -l "您的文件名" {} \;
```

### 步骤 2：查看 entries.json 找到最新版本

```bash
# 查看 entries.json 内容
cat ~/Library/Application\ Support/Cursor/User/History/<目录名>/entries.json | python3 -m json.tool
```

找到 `entries` 数组中 `timestamp` 最大的条目，那就是最新版本。

### 步骤 3：复制历史文件

```bash
# 复制历史文件到您的工作目录
cp ~/Library/Application\ Support/Cursor/User/History/<目录名>/<文件ID>.js <目标路径>
```

## 🛠️ 快速恢复脚本

创建一个脚本 `recover_from_cursor.sh`：

```bash
#!/bin/bash

# 配置
HISTORY_DIR="$HOME/Library/Application Support/Cursor/User/History"
TARGET_FILE="$1"  # 例如: bundle/includes/core.js
OUTPUT_PATH="$2"  # 输出路径

if [ -z "$TARGET_FILE" ] || [ -z "$OUTPUT_PATH" ]; then
    echo "用法: $0 <目标文件路径> <输出路径>"
    echo "示例: $0 bundle/includes/core.js bundle/includes/core.js"
    exit 1
fi

# 查找包含该文件的所有 entries.json
ENTRIES_FILES=$(find "$HISTORY_DIR" -name "entries.json" -exec grep -l "$TARGET_FILE" {} \;)

if [ -z "$ENTRIES_FILES" ]; then
    echo "未找到 $TARGET_FILE 的历史记录"
    exit 1
fi

# 找到最新的 entries.json（按修改时间）
LATEST_ENTRIES=$(echo "$ENTRIES_FILES" | xargs ls -t | head -1)
DIR=$(dirname "$LATEST_ENTRIES")

echo "找到历史记录目录: $DIR"

# 读取 entries.json 并找到最新的条目
LATEST_ID=$(cat "$LATEST_ENTRIES" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if 'entries' in data and len(data['entries']) > 0:
    # 按 timestamp 排序，取最新的
    latest = max(data['entries'], key=lambda x: x.get('timestamp', 0))
    print(latest['id'])
")

if [ -n "$LATEST_ID" ] && [ -f "$DIR/$LATEST_ID" ]; then
    cp "$DIR/$LATEST_ID" "$OUTPUT_PATH"
    echo "✅ 已恢复 $TARGET_FILE 到 $OUTPUT_PATH"
    echo "   来源: $DIR/$LATEST_ID"
else
    echo "❌ 未找到历史文件"
    exit 1
fi
```

使用方法：
```bash
chmod +x recover_from_cursor.sh
./recover_from_cursor.sh bundle/includes/core.js bundle/includes/core.js
```

## 💡 使用 Cursor 内置功能（最简单）

1. 在 Cursor 中右键点击文件
2. 选择 **"Local History"** → **"View History"**
3. 浏览历史版本
4. 选择要恢复的版本
5. 点击 **"Restore"** 或 **"Compare"**

## 🔐 从 Git 恢复（如果代码在 Git 中）

```bash
# 恢复单个文件
git restore <文件路径>

# 恢复所有修改的文件
git restore .

# 查看文件在 Git 中的内容
git show HEAD:<文件路径>

# 恢复到特定提交
git checkout <commit-hash> -- <文件路径>
```

## 📌 当前项目的历史记录位置

根据检查，您的项目相关历史记录可能在：
- `~/Library/Application Support/Cursor/User/History/76844eb9/`
- `~/Library/Application Support/Cursor/User/History/-21096dc2/`

## ⚠️ 预防措施

1. **定期提交到 Git**：`git add . && git commit -m "备份"`
2. **启用 Cursor 的自动保存**
3. **使用版本控制**（Git、SVN 等）
4. **定期备份重要文件**

## 🆘 如果找不到历史记录

1. 检查 Time Machine 备份（macOS）
2. 检查系统回收站
3. 使用数据恢复工具（如 Disk Drill、PhotoRec）
4. 检查是否有其他备份位置
