"""业务节点的 backend 组装：`/user/` 文件路由 +（可选）沙箱 default + 权限规则。

为什么要抽成一份：权限规则必须与 `/user/` 路由**成对出现** —— 没挂路由却传 permissions，
框架会直接抛 NotImplementedError（判定见 `permissions.py` 模块 docstring）。四个节点各写一遍
就迟早有一处漂移，表现是"某个节点直接炸"或"模型拿到路径却读不到文件"，而这两种都不好查。

两种形态：
- **只读节点**（academic / policy / workflow）：default 用 `StateBackend`（纯虚拟、无执行能力），
  `/user/**` 的写操作用 `deny` 直接拒 —— 它们只负责"查资料 + 回答"，要写文件应引导用户
  换通用智能体。**不给沙箱**：那三个场景（政策问答、学业问答、办事流程）不需要跑代码，
  少一个执行入口就少一片攻击面。
- **通用节点**（campusflow/common）：default 是会话级沙箱，`/user/**` 的写按权限档位走
  （ask 问 / auto 产物放行 / full 全放行），模型能跑代码、能把二进制附件送进沙箱解析。
"""
from deepagents import FilesystemPermission
from deepagents.backends import CompositeBackend, FilesystemBackend, StateBackend, StoreBackend
from src.agent.permissions import ALLOW_READ_RULE, USER_ROUTE, build_filesystem_permissions
from src.agent.store.mongdb_store import store
#: 只读节点的写规则：不是"弹卡片问"，是**直接拒绝**。
#: 用 deny 而不是 interrupt 的原因：这三个节点本来就不该落盘，弹卡片等于把
#: "本不该发生的操作"变成一次需要用户判断的打扰，而且用户点了允许也做不成事。
#: 读同样置顶放行 —— 读附件是"本来就该做的事"，任何档位、任何节点都不该弹卡。
READONLY_RULES = [ALLOW_READ_RULE,
                  FilesystemPermission(operations=["write"],
                                       paths=[USER_ROUTE + "**"],
                                       mode="deny")]



def build_file_backend(user_folder: str | None,
                       permission_mode: str | None = None,
                       sandbox=None,
                       *,
                       read_only: bool = False) -> tuple[CompositeBackend, list]:
    """→ `(backend, permissions)`，直接喂给 `create_deep_agent`。

    - `user_folder=None`：不挂 `/user/` 路由（此时 permissions **必须**为空列表）；
    - `sandbox=None`：default 用 StateBackend，模型没有代码执行能力；
    - `read_only=True`：`/user/**` 写操作 deny（忽略 permission_mode 档位）。
    """
    default = sandbox if sandbox is not None else StateBackend()
    routes = {}
    permissions: list = []
    if user_folder:
        routes[USER_ROUTE] = FilesystemBackend(root_dir=user_folder, virtual_mode=True)
        permissions = (READONLY_RULES if read_only
                       else build_filesystem_permissions(permission_mode))
    routes["/memories/"] = StoreBackend(store=store,namespace=lambda rt: ("memories", rt.context.get("user_id", "default")))
    return CompositeBackend(default=default, routes=routes), permissions
