# 校园脉络 Console · 管理后台

校园事务多智能体助手的管理端。按 `stitch_campus_flow_admin_dashboard` 的 6 张设计稿原型开发，
设计系统遵循 `academic_precision/DESIGN.md`（Academic Precision）。

## 快速开始

```bash
npm install
npm run dev      # 默认 5174，被占用时自动顺延
npm run build    # tsc -b && vite build
```

打开后是登录页，用管理员账号登录。数据源默认使用内置 **Mock 数据**
（数值与设计稿一致），可在顶栏右上角切换到**真实接口**。

Mock 模式下的演示账号（**任意密码**）：

| 账号 | 身份 | 结果 |
| --- | --- | --- |
| `10008892` | 林宪成 · 超级管理员 | 正常进入 |
| `2022010834` | 林晨 · 学生 | 被角色闸门拦下，用于演示「非管理员无法进入管理后台」 |

真实接口模式下走 `POST /auth/login` + `GET /users/me`，详见
[接口对接说明.md 3.3](./接口对接说明.md)。

## 七个页面

| 路由 | 页面 | 对应原型 | 接口状态 |
| --- | --- | --- | --- |
| `/observatory` | 系统观察 | `_2` | ✅ 文档第 14 章 |
| `/knowledge-governance` | 知识库治理 | `_6` | ✅ 文档 11.2 |
| `/news` | 新闻治理 | 无（按接口文档补齐） | ✅ 文档第 12 章 |
| `/content-audit` | 内容审核 | `_4` | ✅ 文档第 14 章 |
| `/users-roles` | 用户与角色 | `_5` | ⚠️ 后端未提供，已预留 |
| `/audit-logs` | 操作日志与合规轨迹 | `_3` | ✅ 文档第 15 章 |
| `/system-settings` | 系统设置 | `_1` | ⚠️ 后端未提供，已预留 |

> 「新闻治理」不在 6 张设计稿里，是按接口文档第 12 章与权限表（管理员权限含「新闻源治理」）补的第 7 页：
> 新闻源列表 / 抓取规则编辑 / 立即同步，外加已入库新闻流。

接口逐条映射见 **[接口对接说明.md](./接口对接说明.md)**。

## 目录结构

```
src/
├─ app/                 # 路由与外壳
│  ├─ AdminShell.tsx    # 72px 顶栏 + 88px 侧栏 + 主舞台
│  ├─ RequireAdmin.tsx  # 登录闸门：未登录跳 /login 并带回跳参数
│  └─ App.tsx
├─ components/
│  ├─ ui.tsx            # Badge / Card / Drawer / Modal / Pager / Stat…
│  └─ UsageTrendChart.tsx  # 手写 SVG 三线折线图（含十字准星）
├─ design/
│  ├─ tokens.ts         # 设计令牌（颜色、圆角、阴影、时间范围口径）
│  └─ semantics.ts      # 状态值 → 展示色/文案的唯一映射表
├─ services/            # 每个模块一个文件，mock/live 双分支
│  ├─ http.ts           # 双实例（/api/v1、/api/v2）+ 无感刷新 + 幂等 Key
│  ├─ auth.ts           # 登录 / 当前用户 / 退出（含角色闸门所需资料）
│  ├─ metrics.ts        # 看板与人工复核
│  ├─ knowledge.ts      # 知识库治理
│  ├─ files.ts          # 一步式文件上传（/files/presign）+ 扫描状态轮询
│  ├─ news.ts           # 校园新闻流与新闻源治理
│  ├─ audit.ts          # 审计日志
│  ├─ users.ts          # ⚠️ 预留：/admin/users、/admin/roles
│  └─ settings.ts       # ⚠️ 预留：/admin/settings、高危维护操作
├─ stores/
│  ├─ dataMode.ts       # Mock / 真实接口开关
│  └─ session.ts        # 管理端会话：真实登录 + role==='admin' 闸门
├─ hooks/queries.ts     # 所有 React Query 钩子，queryKey 带数据源模式
├─ mocks/data.ts        # Mock 数据（数值对齐设计稿）
└─ styles/
   ├─ base.css          # 字体、画布、滚动条、动画
   ├─ admin.css         # 设计系统组件层
   ├─ pages.css         # 各页面的布局层
   └─ login.css
```

## 设计系统要点

改样式前先读这一段，否则很容易破坏整体调性。

- **拒绝 3D 光照、彩色辉光、毛玻璃**。层级只靠 1px 结构线（`#E2E8F0`）与极小环境阴影表达。
- **珊瑚红 `#E0564C` 是手术刀**，只用于活跃状态、高风险干预、冲突标记。
  大面积铺色会毁掉这套中性的学术基调。
- **选中态不上浮、不投影**，只立一根 3px 珊瑚红左锚定条（见 `.rail-item.active`、`tr.selected`）。
- **数字一律 `tabular-nums`**，日志 / 规则 / JSON 用 JetBrains Mono（`.mono`）。
- **同状态必同色**：`design/semantics.ts` 是唯一来源，组件里不要内联写三元色值判断。
- 时间范围统一走 `RANGE_OPTIONS`，别自己拼 `'7d'` 这类字符串。

## 双模式数据源

`stores/dataMode.ts` 提供 `isMock()`，每个 service 函数据此分支。切到 live 后：

- 所有查询的 `queryKey` 带 `mode`，自动失效重取；
- 请求失败按**空态 + 错误提示**处理，**不回落到 mock** ——
  免得把「后端没返回」误判成「后端返回了 0」；
- 指标类接口的 `data_complete=false` 时，缺失值显示 `—` 而非 `0`。

## 联调代理

`vite.config.ts` 已按文档 5.1 配置：

```
/api/v1 → 127.0.0.1:8080   业务服务（管理后台全部接口都在这里）
/api/v2 → 127.0.0.1:8000   AI 服务（为后续预留）
```

## 已知缺口

- 管理端复用用户端 `POST /auth/login`，放行条件在前端判 `role === 'admin'`。后端未提供管理端专用入口，
  约定为「同一套令牌 + 前端角色闸门」。`/users/me` 不返回角色中文名，顶栏标签按枚举映射。
- 用户角色、系统设置两页的接口路径为拟定草案，搜索代码里的 `RESERVED` 可找到全部待确认点。
- 趋势图三线、审核抽屉分析报告依赖扩展字段，后端未返回时自动降级，不会报错。
