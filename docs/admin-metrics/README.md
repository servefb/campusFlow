# 管理看板接口（契约第 14 章 `/admin/metrics/*`、`/admin/reviews/*`）

> 记的是**后端实现现状 + 口径定义**，不是契约的副本。契约以《校园事务智能助手后端接口文档.md》第 14 章与 §A.9 为准。
> 本文件的存在理由是：契约 §A.9.4 的样例**没写清楚几个桶怎么来的**，而库里的事实与样例对不齐 —— 这些差异必须有个落笔的地方，否则联调时两边各猜一套。

## 一、实现现状

后端（`C:/Users/Lenovo/IdeaProjects/campusflow`，业务服务 `/api/v1`）。2026-09-21 实测：

| 方法 | 路径 | 后端 | 说明 |
| --- | --- | --- | --- |
| GET | `/admin/metrics/knowledge-health` | ✅ 已实现 | 本次交付，见下文 |
| GET | `/admin/metrics/overview` | ❌ | `AdminMetricsController` 里还没有 |
| GET | `/admin/metrics/trends` | ❌ | 同上 |
| GET | `/admin/metrics/agents` | ❌ | 同上（依赖 `agent_runs` 的统计） |
| GET | `/admin/metrics/hot-questions` | ❌ | 同上（依赖 `messages` + 分类，成本最高） |
| GET | `/admin/reviews` | ❌ | 复核工单，整组还没落地 |
| GET | `/admin/reviews/{id}` | ❌ | |
| POST | `/admin/reviews/{id}/resolve` | ❌ | |

前端（`campusflowadmin`）已按契约全部接好（`src/services/metrics.ts`），**非 live 模式走 mock**（`src/mocks/data.ts`）。
所以「看板能显示数字」不代表后端有实现 —— 切到 live 才验得出来。

## 二、路径与鉴权

- 前端 `baseURL = /api/v1` + `/admin/metrics/knowledge-health`；nginx 反代**会剥掉 `/api/v1`**
  → 服务内部路径就是 `/admin/metrics/knowledge-health`。别在 `@RequestMapping` 里补 `/api/v1`。
- `JwtInterceptor` 拦 `/**`：**不带 token → 真实 HTTP 401**。
- `token` 里**只有 `userId`**（`UsersServiceImpl.login` 的 claim 里没放角色），全工程也没有角色拦截器。
  所以「必须是管理员」这层是**按 userId 回查 `users.role`** 做的（`users.role` 枚举：`student/teacher/admin`）。
  副作用是好的：用户一旦被降权，旧 token 立刻失效，不用等过期。
- ⚠️ 非管理员拿到的是 **HTTP 200 + body 里 `code:403`**，不是 HTTP 403。
  这是本工程既有约定（`BusinessException` 的 handler 没带 `@ResponseStatus`，登录密码错的 401 也一样走 body）。
  管理端的响应拦截器**只认 HTTP 401 去刷新 token，不检查 body 里的 `code`** ——
  所以非管理员打开看板不会弹错，页面只是静默退化成 `—`。**不泄露数据，但也没有提示。**
  要改的话二者选一：给 `BusinessException` 的 handler 按 code 动态设 HTTP 状态；或前端拦截器统一 `code !== 0` 就 reject。**属于全局改动，需要拍板。**

## 三、`documents` 的口径（与契约样例的差异都在这）

`knowledge_documents.status` 的库枚举有 **6** 个：`draft / processing / ready / failed / offline / archived`，
而契约样例只给了 **4** 个桶。**本实现不合并**，六桶各自成键，另加 `total`：

| 键 | 含义 | 来源 |
| --- | --- | --- |
| `ready` | 已就绪、可被检索 | `status='ready'` |
| `processing` | 正在跑解析/切片/索引流水线 | `status='processing'` |
| `failed` | 处理失败，需人工介入 | `status='failed'` |
| `offline` | 人工下线，不再被检索 | `status='offline'` |
| `draft` | 已建档但还没开始跑流水线 | `status='draft'` |
| `archived` | 已归档 | `status='archived'` |
| `total` | 以上之和，供前端做一致性校验 | 计算值 |

为什么不把 `archived` 并进 `offline`、把 `draft` 并进 `processing`：并了就**再也看不出**「下线」里混了「归档」，
而且 6 项之和 ≠ 总数这件事会静默消失。多给键是超集，前端类型是 `Record<string, unknown>`，不会有副作用。

> 软删：一律排除 `deleted_at IS NOT NULL`。本工程没有 `@TableLogic`，软删不会自动过滤，必须显式写。

## 四、`fulltext_index` 的口径

⚠️ **`knowledge_sections` 表里没有「是否已建索引」的标记位**。库里只有一条
`FULLTEXT INDEX idx_knowledge_sections_text_fulltext` —— 那是 MySQL 自动维护的，全表都在里面。
所以「已索引 / 待索引」只能按**文档状态**推导，分界就是「这份文档现在能不能被检索到」：

| 键 | 口径 |
| --- | --- |
| `indexed_sections` | 属于 `ready` 文档的**当前版本**切片数 |
| `pending_sections` | 属于 `draft` / `processing` 文档的**当前版本**切片数 |
| `last_completed_at` | `MAX(knowledge_job_steps.completed_at)`，条件 `stage='fulltext_indexing' AND status='completed'` |

两点必须记住：

1. **必须限定 `is_current = 1`。** `knowledge_document_versions` 上有唯一索引 `uq_knowledge_current_version`
   （`is_current` → `document_id` 的唯一映射），保证一份文档只有一个当前版本。不加这个条件，
   换过版的文档会把历史版本的切片重复计入。
   （当前数据里是否加它都是 156 —— 因为还没有文档换过版；这个条件是给将来兜底的。）
2. **`failed / offline / archived` 的切片两边都不计。** 它们不会自动变成可检索，
   归进 `pending_sections` 会让人以为「排队等着，会好的」。
3. `last_completed_at` **一次都没跑完过时回 `null`**（前端渲染 `—`）。不要兜底成 `now()`/`0`，
   那会显示一个假的「刚刚索引过」。

## 五、与契约样例的三处差异（汇总）

| 差异 | 说明 |
| --- | --- |
| `documents` 多 3 个键 | `draft` / `archived` / `total`，见 §三 |
| 没有 `vector` 块 | 管理端 `ObservatoryPage` 会读 `data.vector.engine / similarity / chunks / embedding_model`。这些来自**向量库（Milvus）**，归属 AI 服务，本服务没有事实来源 → 按「接口没有的字段一律不写、不编」留空，那几处会渲染 `—`。要让它有值，得先补契约、再由 AI 服务提供。 |
| `updated_at` 语义 | 是**本次统计的执行时刻**（快照时间），不是任何一张表的 `updated_at` 最大值。两个时间戳都截到秒（契约样例也是秒精度）。 |

## 六、其他已知缺口

- **`request_id` 契约有、实现无。** 契约第 14 章写「所有指标响应必须携带」，每个样例里也都有，
  但 `common/.../response/Result.java` 只有 `code/message/data` 三个字段，全仓也没有
  Filter/Aspect 往响应里塞它（`requestId` 只作为 `audit_logs` 表的一列存在）。
  要补得加 Filter（生成 UUID → 塞进响应体 + MDC 进日志），**光给 `Result` 加字段没用**。
  管理端不读这个字段，所以现在不会报错、只会静默缺失。
- 另外四个指标接口与三个复核接口见 §一。
- `/admin/metrics/*` 铺开时，「必须是管理员」这段判断应抽成公共组件（或给 `WebConfig` 加一条
  `/admin/**` 拦截规则），别每个实现类抄一份。

## 七、怎么验

```bash
# 1) 拿一个管理员 token（userId=19 是种子数据里的 admin1001）
# 2) 直连业务服务
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8080/admin/metrics/knowledge-health

# 期望（2026-09-21 的真实数据）
# {"code":0,...,"documents":{"ready":9,"processing":0,"failed":1,"offline":0,"draft":0,"archived":1,"total":11},
#  "fulltext_index":{"indexed_sections":156,"pending_sections":0,"last_completed_at":"2026-09-14T09:35:28+08:00"},
#  "pending_conflicts":1}
```

SQL 与口径推导见 `AdminMetricsMapper` / `AdminMetricsServiceImpl` 的类注释（Java 仓）。
