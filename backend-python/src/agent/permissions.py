"""按前端「批准方式」档位生成 deepagents 的文件权限规则。

前端 `PromptComposer` 的三档（见前端 services/permissionMode.ts）随请求体的
`permission_mode` 传来，经 config.configurable 进入节点，在这里翻译成
deepagents 的 FilesystemPermission 列表。

⚠️ **硬约束**（deepagents 现版本的限制）：框架**不支持**「permissions + 支持命令
执行的 backend」同时启用 —— 除非所有权限路径都落在 `CompositeBackend` 的
**路由前缀内**。判定见 `deepagents/middleware/filesystem.py:1824`：

    if _permissions and supports_execution(backend) and not _all_paths_scoped_to_routes(...):
        raise NotImplementedError("...Tool-level permissions for the execute tool are not implemented...")

原因是 execute 走 default backend、**不受路由约束**，框架没法给 execute 按路径控权。

因此这里**只写 `/user/**`**（用户工作文件夹那条路由）：
- 沙箱内路径（`/workspace/**`）不受 permissions 管辖，保持默认放行；
- 调用方必须在**没挂 `/user/` 路由时传空列表** —— routes 为空时同样过不了上面的
  判定（`_all_paths_scoped_to_routes` 会直接返回 False），照样抛错。

规则语义（`_check_fs_permission`）：顺序遍历、**第一条命中即生效**；
一条都不命中默认放行，所以具体规则要写在前面。
"""
from deepagents import FilesystemPermission

#: 与前端 PermissionMode 对齐；未知值一律按最保守的 ask 处理
PERMISSION_MODES = ("ask", "auto", "full")
DEFAULT_PERMISSION_MODE = "ask"

#: 用户工作文件夹的路由前缀，必须与 CompositeBackend 的 routes key 一致
USER_ROUTE = "/user/"

#: **读永远放行**（用户拍板）：读附件、读工作文件夹里的材料是"本来就该做的事"，
#: 不该变成一次需要用户点头的打扰 —— 用户什么都没做错，却要为每次读取点一下卡片。
#: 置顶写死的原因：规则第一条命中即生效。只要这条在最前面，后面无论谁加了什么规则
#: （包括将来误加的 read→interrupt），读都不会被拦下来。
#:
#: 注意它只覆盖 `read`。`execute`（沙箱里跑代码）不在这里 —— 那条路由不受路径
#: 约束、框架也不支持给 execute 按路径控权（见模块 docstring）。
ALLOW_READ_RULE = FilesystemPermission(
    operations=["read"], paths=[USER_ROUTE + "**"], mode="allow")


#: 子智能体专用的写规则。**刻意不含任何 `interrupt` 档** —— 子智能体没有 checkpointer，
#: 在它内部弹卡等于「卡能弹、批准后续跑语义未定义」（09-19 实测撞过，见
#: `campusflow_agent_node` 模块注释）。改为「产物目录直接放行 + 改用户原文件直接拒绝」：
#:
#: - `ai_output/**` 放行：通用子智能体的职责就是产出文件（`subagent_prompts.py:123`
#:   要求产物统一写到 ai_output），不该为它弹卡；
#: - 其余 `/user/**` 一律 `deny`：把「改用户原文件」**推回主智能体** —— 外层图有
#:   `AsyncPostgresSaver`，只有在那里弹的卡才能正常续跑。这同时把提示词里那句
#:   「不覆盖用户原文件」从**劝**变成**代码保证**。
#:
#: ⚠️ **顺序不能颠倒**：规则第一条命中即生效，`ai_output` 的 allow 必须在 `/user/**` deny 之前。
#:
#: ⚠️ **为什么子智能体的 permissions 必须显式声明**（这是本条存在的理由）：
#:    `deepagents/graph.py:683` `subagent_permissions = spec.get("permissions", permissions)`
#:    —— spec 不写就**继承主智能体的**，而主智能体在 ask/auto 档下含
#:    `write: /user/** → interrupt`。更坑的是 `spec["interrupt_on"] = {}` **清不掉**这些卡：
#:    `_merge_fs_interrupt_on`（`graph.py:191`）只按「同名工具」覆盖，空 dict 里没有工具名，
#:    permissions 生成的 `write_file` / `edit_file` / `delete` 卡会**原样留下**。
#:    本模块的 `_build_interrupt_on_from_permissions` 对下面这套规则返回 `{}`（无 interrupt 档），
#:    所以子智能体侧不会再挂 `HumanInTheLoopMiddleware`。
SUBAGENT_RULES = [
    ALLOW_READ_RULE,
    FilesystemPermission(operations=["write"], paths=[USER_ROUTE + "ai_output/**"], mode="allow"),
    FilesystemPermission(operations=["write"], paths=[USER_ROUTE + "**"], mode="deny"),
]


def build_filesystem_permissions(mode: str | None) -> list[FilesystemPermission]:
    """档位 → 权限规则（只覆盖 `/user/**`，原因见模块 docstring）。

    - **读**：任何档位都放行，不弹卡片（`ALLOW_READ_RULE`，永远排第一条）；
    - ask（请求批准）：改写用户电脑上的文件一律先问；
    - auto（帮我批准）：写产物（ai_output）直接放行，改用户原文件要先问；
    - full（完全访问权限）：全放行。

    即：档位只决定**写**要不要问，读不受影响。
    """
    if mode not in PERMISSION_MODES:
        mode = DEFAULT_PERMISSION_MODE

    user_all = USER_ROUTE + "**"

    if mode == "full":
        return [ALLOW_READ_RULE,
                FilesystemPermission(operations=["write"], paths=[user_all], mode="allow")]

    if mode == "auto":
        return [
            ALLOW_READ_RULE,
            # 产物目录：直接写，不打扰
            FilesystemPermission(operations=["write"], paths=[USER_ROUTE + "ai_output/**"], mode="allow"),
            # 用户文件夹其余位置：改用户原文件要先问
            FilesystemPermission(operations=["write"], paths=[user_all], mode="interrupt"),
        ]

    # ask：只要写用户文件夹就问
    return [ALLOW_READ_RULE,
            FilesystemPermission(operations=["write"], paths=[user_all], mode="interrupt")]
