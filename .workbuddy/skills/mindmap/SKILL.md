---
name: mindmap
description: 图表工作台（12 种图表：思维导图 / 流程图 / 架构图 / 时序图 / 状态图 / 类图 / ER 图 / 鱼骨图 / 时间线 / 组织结构图 / 甘特图 / 概念图）。当用户要求把主题整理成思维导图/脑图/树状大纲，或画流程图、时序图、状态机、类图、ER 图、鱼骨图、里程碑、组织架构、甘特排期，或要求图表之间互转，或提到 charts/*.chart.json 时使用。触发词：思维导图、脑图、mindmap、流程图、架构图、时序图、状态图、类图、ER 图、鱼骨图、时间线、组织结构图、甘特图、Mermaid。
---

# 图表工作台（12 种图表 · 一个页面）

本地工具，**数据就是文件**：`charts/<标题>.chart.json`，WorkBuddy 直接读写即可。
12 种图表共用一套 `nodes/links` 语义，任意两种类型都能互转（走大纲中转）。

## 路径

- 工具根目录：**本仓库根目录**（`server.py` 所在目录），下面提到的路径都是相对它
- 数据目录：`charts/`（`*.chart.json`），历史快照 `charts/.history/`，示例底稿 `charts/.samples/`
- 启动界面：`python server.py --open`（Windows 也可双击 `start.bat`，macOS/Linux 用 `./start.sh`）→ http://127.0.0.1:8712/
- 只有一个前端 `/studio/`；旧版 `/classic/`、`/diagram/` 已下线（访问会跳回工作台）

## 12 种图表：直接写 JSON

坐标可以完全省略（打开时自动布局），只要给出 `id` / `text` / 关系：

```json
{
  "schema": "workbuddy-chart/v1",
  "id": "用户登录时序",
  "type": "sequence",
  "title": "用户登录时序",
  "theme": "classic",
  "nodes": [
    { "id": "u", "text": "用户" }, { "id": "s", "text": "前端" }, { "id": "a", "text": "服务端" }
  ],
  "links": [
    { "id": "e1", "from": "u", "to": "s", "label": "点击登录", "kind": "sync" },
    { "id": "e2", "from": "s", "to": "a", "label": "POST /login", "kind": "sync" }
  ],
  "meta": {}
}
```

| type | 节点特有字段 | 连线 |
| --- | --- | --- |
| `mindmap` | `parent`（树）、`color`、`done`、`collapsed` | 由 `parent` 自动生成，不用写 links |
| `org` | `parent`、`role` | 同上 |
| `fishbone` | `parent`、`kind`: `head`/`branch`/`cause` | 同上 |
| `flow` | `shape`: `process`/`decision`/`terminal`/`io` | `from`/`to`/`label`（是/否） |
| `arch` | `kind`: `client`/`service`/`module`/`data`/`ext`、`tier`（层号） | `from`/`to`/`label`、`meta.tiers:[层名]` |
| `sequence` | 参与者按数组顺序排列 | `label` + `kind`: `sync`/`reply`/`async` |
| `state` | `kind`: `state`/`start`/`end` | `label`（迁移条件） |
| `class` | `members:[{text, kind}]`（kind 取 attr 或 method）、`kind:'interface'` | `kind`: `inherit`/`impl`/`compose`/`aggreg`/`assoc` |
| `er` | `attrs:[{text, pk}]`、`kind` 取 entity 或 relation | `label`（基数） |
| `timeline` | `date`（如 `2026-10`）、`side`(l/r) | 无 |
| `gantt` | `start`(YYYY-MM-DD)、`days`、`progress`、`owner` | 无，`meta.start/end` 控制时间窗 |
| `concept` | 自由节点，可给 `x`/`y` | `label` |

> **思维导图的排布方式**写在文档级 `meta.layout`：`balanced`（双向发散，默认）/ `right`（向右展开）/
> `down`（向下树）/ `up`（向上树）/ `radial`（环形放射）。用户说"改成环形/换种排布"时改这个字段即可，
> 节点坐标不用管；界面上对应顶栏「布局」菜单和右侧属性面板的布局胶囊。
>
> **图片**（仅 mindmap / flow / arch / concept）：`node.images = [{data, w, h}]` 可放多张（单图也认旧字段
> `image`/`imgW`/`imgH`）。节点**没文字只有图**时会铺满节点，写了文字就变顶部缩略图——想让它大就留空 `text`。
>
> **折叠**：`node.collapsed = true` 收起该节点下级（数据都还在）。适合把大图先收成骨架。
>
> **兄弟顺序**：树形图按 `nodes[]` 里的**数组顺序**排兄弟（左右布局从上到下，上下布局从左到右）。
> 想让某个分支排在前面，把那个节点在数组里提到前面即可——不用动坐标。

## 标准流程

1. **先看已有的**：`curl -s http://127.0.0.1:8712/api/charts` 拿列表，避免重复创建同名图。
2. **想清楚结构**：中心主题 → 3~7 个一级分支 → 每个 2~5 个二级节点；节点文字要短（一句话、≤20 字），
   细节放 `note`。
3. **写文件**：`charts/<标题>.chart.json`（UTF-8，`ensure_ascii=False` 更易读）。同名文件覆盖即更新。
4. **校验**：`curl -s http://127.0.0.1:8712/api/charts/<url 编码后的标题>` 能读回来即成功；
   也可以 `curl -X POST .../api/charts/<标题>/reset` 之类做后续操作。
5. **回复用户**：给出图表标题、结构摘要（一级分支清单），提示打开 http://127.0.0.1:8712/ 查看；
   服务没起来就让用户运行 `start.bat` 或 `python server.py`。

改已有图时：先 GET 读回 JSON → 改 `nodes`/`links` → 写回同一路径。不要改 `id`，否则会被当成新图。

## 选哪种图

- 有先后步骤与分支 → `flow`（判断节点用 `shape: decision`）
- 有模块与服务依赖、分层 → `arch`（`tier` 决定层）
- 参与者之间来回发消息 → `sequence`
- 状态与迁移条件 → `state`
- 类/字段/方法/继承 → `class`；实体与基数 → `er`
- 问题 → 原因归类 → `fishbone`
- 只是发散梳理 → `mindmap`；部门汇报线 → `org`；按日期罗列 → `timeline`；排期与进度 → `gantt`；概念间关系 → `concept`

不确定就问一句，或先出 `flow`（换成其它类型可以一键转换）。

## 命令备忘录

```bash
curl -s http://127.0.0.1:8712/api/charts                      # 列出全部图表
curl -s http://127.0.0.1:8712/api/charts/<id>                 # 读取单张
curl -X PUT http://127.0.0.1:8712/api/charts/<id> \
     -H "Content-Type: application/json" -d '{"chart":{...}}' # 保存（自动留快照）
curl -X POST http://127.0.0.1:8712/api/charts                 # {title,type,doc} 新建
curl -X DELETE http://127.0.0.1:8712/api/charts/<id>          # 删除（示例图返回 403）
node tools/test_convert.js                                    # 12×12 互转验证
node --test tools/kinds.test.js                               # 类型库单测
node tools/seed_charts.js                                     # 重建全部示例
```

## 注意

- 示例图表（`meta.example` 或 id 以「示例」开头）不可删除，改乱后可 `POST /api/charts/<id>/reset` 重置。
- 节点 `id` 在一张图内唯一即可（`n1`、`n2` 这种就行），不要跨图复用。
- 想给用户看的成品图：让用户在界面里「导出 → PNG / SVG（透明底）」；不要自己画 SVG 冒充图表。
- 旧版 `maps/`、`diagrams/` 数据与 `mm.py`、`dg.py` 已下线，不再参与运行。
