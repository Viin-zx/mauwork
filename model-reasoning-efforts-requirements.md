# 模型思考档位（每模型可配置）需求文档

- 状态：待后端/管理前端实现，客户端按本文契约改造
- 涉及系统：mioagent 业务后端、miowork-admin 管理前端、Mauwork 桌面客户端（llm-mio / ui-model-selection）
- 关联：客户端现有实现为「按模型名称内置厂商档位表 + 英文档位名」，本次全部替换

## 1. 背景与目标

模型选择器需要按模型展示不同的思考深度档位（例如 DeepSeek-V4 快照三档、GLM-5.2 七档、GPT-5 五档）。档位今后**由后台每个模型一行配置**：

- 后台是唯一权威来源，客户端不再内置按名称推断的档位表；
- 运营在管理后台新增模型时按名称自动预填档位模板，可手动修改；
- 新增模型或厂商调整档位时，只改后台，不需要更新客户端；
- 客户端展示**中文档位名**。

## 2. 数据契约（后端 → 客户端）

客户端模型目录（`GET /models`，账号 Token）中，`LANGUAGE` 模型的 `parameters` 新增/复用两个字段：

```json
"parameters": {
  "reasoningEfforts": ["low", "medium", "high", "max"],
  "reasoningEffort": "high"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `reasoningEfforts` | `string[]`，可选 | 该模型可选的档位 id 列表；**缺省或空数组 = 该模型不提供思考档位** |
| `reasoningEffort` | `string \| null`，可选 | 默认档位，必须是 `reasoningEfforts` 中的一项；**空/null = 跟随上游默认** |

档位 id 固定枚举（全小写，客户端与后台一致）：

| id | 中文名 | 英文名 |
|---|---|---|
| `off` | 关闭 | Off |
| `minimal` | 最低 | Minimal |
| `low` | 低 | Low |
| `medium` | 中 | Medium |
| `high` | 高 | High |
| `xhigh` | 极高 | Extra High |
| `max` | 最大 | Max |

约定：

1. 客户端按上表固定顺序展示，与数组顺序无关。
2. `off` 表示"不思考"（请求不带推理参数）；不希望允许关闭思考的模型不要包含 `off`。
3. 两个字段只对 `LANGUAGE` 模型有意义，其它类型不返回。
4. 未配置默认档时，客户端显示「默认」（英文环境 Default），表示跟随上游默认值。

## 3. 数据库改动

模型表新增一列，复用原有列：

| 列 | 类型 | 说明 |
|---|---|---|
| `reasoning_efforts` | json（或 varchar 存 JSON 数组） | 新列，可选档位列表；NULL/空数组 = 不提供 |
| `reasoning_effort` | 现有列 | 语义定为"默认思考档"，取值必须为空或属于 `reasoning_efforts` |

## 4. 接口改动

### 4.1 管理端

- `GET /mio/admin/v1/models`、`GET /mio/admin/v1/models/{id}`：返回上述两个字段。
- `POST /mio/admin/v1/models`、`PUT /mio/admin/v1/models/{id}`：接收并持久化。
- 模型类型不是 `LANGUAGE` 时：字段不展示/不接收，或接收后清空（建议拒绝并提示）。
- 模型类型由 `LANGUAGE` 改为其它类型时清空两字段；复制模型时一并复制。

### 4.2 客户端目录

- `GET /models`：每个 `LANGUAGE` 模型的 `parameters` 中返回 `reasoningEfforts` / `reasoningEffort`。
- 未配置时**省略字段**（不要返回空字符串或 `[]` 之外的占位值；`[]` 等价于不提供）。
- 其它字段与过滤规则（仅启用模型）不变。

## 5. 校验规则（保存时，400 返回可读原因）

1. `reasoningEfforts` 每个值必须在七档枚举内，去重后保存。
2. 非空列表至少包含一个非 `off` 档位。
3. `reasoningEffort` 为空，或必须存在于 `reasoningEfforts`。
4. 非 `LANGUAGE` 模型携带档位按 4.1 的约定处理。
5. 客户端对非法值做防御：未知档位忽略、默认不在列表则退回「默认」，不报错；后端仍须保证非法值不落库。

## 6. 存量回填与模板

客户端将删除内置名称表，**字段为空的模型上线后没有档位菜单**。上线前必须回填现有 `LANGUAGE` 模型。管理前端维护一份模板 JSON（新增模型时按名称预填，可手动修改），回填用同一映射：

| 匹配（不区分大小写） | 档位 |
|---|---|
| `deepseek-*-flash-0731`、`deepseek-*-pro-0813` | low / high / max |
| `deepseek-v4*`、`deepseek-reasoner*`、`deepseek-r1*` | high / max |
| `glm-5.3*` | low / high / max |
| `glm-5.2*` | off / minimal / low / medium / high / xhigh / max |
| `glm-5*`、`glm-5.1*` | off / minimal / low / medium / high / xhigh |
| `qwen3.8*` | low / medium / xhigh |
| `kimi-k3*` | high / max |
| `minimax-m3.1*` | low / medium / high / xhigh / max |
| `gpt-5*`（不含 pro） | off / minimal / low / medium / high |
| `gpt-5-pro*` | high |
| `gpt-5.1-codex-max*`、`gpt-5.5*` | off / low / medium / high / xhigh |
| `o1*`、`o3*`、`o4*` | low / medium / high |
| `claude-opus|sonnet-4[.-][6-9]*` | low / medium / high |
| `claude-sonnet-5*` | low / medium / high / xhigh / max |
| `gemini-3*-pro*`、`gemini-3*-flash*` | low / medium / high |
| `gemini-2.5*` | off / low / medium / high |
| `grok-4*`、`grok-5*` | low / medium / high / xhigh |
| `grok-3-mini*` | low / high |
| 其它（生图/视频/embedding/未识别） | 不配置 |

说明：

- 匹配对象是客户端收到的模型名称（即下发为 `modelId` 的字段），请确认后台"模型名称"列就是该值。
- 上表按各厂商 2026-10 公开文档整理；厂商调整档位后只改模板与对应模型，无需改客户端。
- 管理端列表建议对「档位未配置」的 `LANGUAGE` 模型做标记，避免漏配。

## 7. 客户端改动（本仓库）

1. `mio-account` wire：`parameters` 增加 `reasoningEfforts: string[]`（元素校验七档）、`reasoningEffort` 复用为默认档。
2. `llm-mio`：按字段投影到模型目录（列表 + 默认档）；**删除** `src/reasoning.ts` 名称表及其测试。
3. `ui-model-selection`：档位名改为中文（关闭/最低/低/中/高/极高/最大），未设默认显示「默认」；英文环境保持英文名。目录只传档位 id，由客户端本地化。
4. 文档：同步 `llm-mio` README 中英文说明。

## 8. 兼容性与生效时间

- 老客户端不解析新字段，行为不变（本来也没有档位菜单）。
- 新客户端 + 旧后台（无字段）→ 所有模型无档位菜单，直到后台回填；因此**上线顺序：后台字段 + 回填 → 客户端发版**。
- 客户端模型目录缓存 60 秒，后台修改最长 60 秒后生效，无需重启客户端。

## 9. 验收用例

1. 新建 `LANGUAGE` 模型，配置 `["low","high"]` + 默认 `high` → 选择器显示「低 / 高」，默认选中「高」。
2. 改为五档 → 60 秒内菜单更新，中文名正确。
3. 清空档位 → 菜单消失，模型仍可正常对话。
4. 提交 `["high","ultra"]` → 400，提示非法档位。
5. 默认档不在列表内 → 400。
6. 非 `LANGUAGE` 模型带档位 → 按约定拒绝或清空。
7. 回填后核对现有聊天模型：`deepseek-v4.1-flash-1017` → 高/最大；`deepseek-v4-flash-0731` → 低/高/最大；`minimax-m3`、`MiniMax-H3` → 不配置。
8. 中英文环境分别核对档位名显示。
