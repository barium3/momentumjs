# Cursor 检查点恢复指南

## 方法一：从 Git 恢复（推荐）

如果您的代码在 Git 仓库中，可以使用以下命令恢复：

```bash
# 恢复单个文件
git restore <文件路径>

# 恢复所有被修改的文件
git restore .

# 查看文件的历史版本
git show HEAD:<文件路径>

# 恢复到特定的提交
git checkout <commit-hash> -- <文件路径>
```

## 方法二：从 Cursor 历史记录恢复

Cursor 会自动保存文件的历史版本，位置在：

**macOS:**
```
~/Library/Application Support/Cursor/User/History/
```

**Windows:**
```
%APPDATA%\Cursor\User\History\
```

**Linux:**
```
~/.config/Cursor/User/History/
```

### 查找特定文件的历史记录：

1. **查找包含特定文件的 entries.json：**
```bash
find ~/Library/Application\ Support/Cursor/User/History -name "entries.json" -exec grep -l "core.js" {} \;
```

2. **查看历史记录目录：**
每个历史记录目录包含：
- `entries.json` - 记录文件的历史版本列表
- 各种 `.js` 文件 - 这些是文件的历史快照

3. **读取 entries.json 找到最新版本：**
```bash
cat ~/Library/Application\ Support/Cursor/User/History/<目录名>/entries.json
```

4. **复制历史文件到工作目录：**
```bash
cp ~/Library/Application\ Support/Cursor/User/History/<目录名>/<文件ID>.js <目标路径>
```

## 方法三：使用 Cursor 内置功能

1. **右键点击文件** → **Local History** → **View History**
2. 选择要恢复的版本
3. 点击恢复

## 方法四：查找工作区存储

Cursor 的工作区存储位置：
```
~/Library/Application Support/Cursor/User/workspaceStorage/
```

每个工作区都有一个唯一的 ID，可以在其中找到备份文件。

## 当前项目的历史记录位置

根据检查，您的项目历史记录可能在：
- `~/Library/Application Support/Cursor/User/History/76844eb9/`
- `~/Library/Application Support/Cursor/User/History/-21096dc2/`

## 快速恢复脚本

创建一个恢复脚本：

```bash
#!/bin/bash
# 恢复 core.js 从 Cursor 历史记录

HISTORY_DIR="$HOME/Library/Application Support/Cursor/User/History"
TARGET_FILE="bundle/includes/core.js"

# 查找最新的历史记录
LATEST=$(find "$HISTORY_DIR" -name "entries.json" -exec grep -l "$TARGET_FILE" {} \; | xargs ls -t | head -1)

if [ -n "$LATEST" ]; then
    DIR=$(dirname "$LATEST")
    # 读取 entries.json 获取最新版本
    LATEST_ID=$(cat "$LATEST" | grep -o '"[^"]*\.js"' | tail -1 | tr -d '"')
    if [ -n "$LATEST_ID" ]; then
        cp "$DIR/$LATEST_ID" "$TARGET_FILE"
        echo "已恢复 $TARGET_FILE"
    fi
fi
```

