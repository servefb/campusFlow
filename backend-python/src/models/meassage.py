from typing import List, Optional

from fastapi import UploadFile
from pydantic import BaseModel


class Message(BaseModel):


    # 本轮提问内容（resume 续跑时放用户作答的人话版本）
    content: str
    # 提问模式：chat = 纯对话、跳过 Agent 调度；agent = 交给 Agent 处理
    mode: str = "agent"
    # Agent 路由：auto（智能路由）或具体 Agent key
    agent_mode: str = "auto"
    # 回答偏好：concise / balanced / detailed
    answer_style: Optional[str] = None
    # 深度思考等级：off / low / high / max（后端自行映射推理预算）
    thinking_level: Optional[str] = None
    # 会话标题（仅新建会话时前端会带）
    title: Optional[str] = None
    # ask_user 作答（JSON 字符串），带它表示续跑被中断的线程
    resume: Optional[str] = None
    # 来源标记（仅新建会话时前端会带，如 conversation / workspace）
    source: Optional[str] = None
    # 回传则续接同一会话线程
    conversation_id: Optional[str] = None
    # 工作区：<rootKey>:<相对路径>（如 d:exam）
    workspace_path: Optional[str] = None
    # 权限档位：ask / auto / full
    permission_mode: Optional[str] = None
    # 引用片段 id：multipart 里重复同名字段
    quoted_section_ids: Optional[List[str]] = None
    # 附件本体：multipart 里可重复的 files 字段
    files: List[UploadFile] = []
