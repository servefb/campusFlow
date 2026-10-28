import datetime
import json
from typing import List, Dict, Any, Optional


from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
from sqlalchemy.orm import selectinload
from src.agent.llm.llm_node import model
from src.agent.prompt.document_match import FILE_MATCH_PROMPT
from src.agent.prompt.temp_match import prompt
from src.db.db_Knowledge import KnowledgeDocument
from src.db.db_task_temp import TaskTemplate
from src.db.db_user import User
from src.models.common_responce import result


async def get_tasks_templates_match_to_llm(title: str, session: AsyncSession):
    template_catalog = await get_all_templates_catalog(session)
    message = prompt.invoke({"title": title, "template_catalog": template_catalog})
    res = model.invoke(message,config={"tags": ["internal"]})
    return result.success(data={
        "items": json.loads(res.content)
    })


def _fmt(v) -> Optional[str]:
    if v is None:
        return None
    # 注意 datetime 是模块，真正的类型是 datetime.datetime / datetime.date
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    return str(v)


def _row_to_dict(doc: KnowledgeDocument) -> Dict[str, Any]:
    return {
        "document_id": doc.id,
        "document_no": doc.document_no,
        "title": doc.title,
        "category": doc.category.name if doc.category else None,
        "issuer_level": doc.issuer_level,
        "issuer_organization": (
            doc.issuer_organization.name if doc.issuer_organization else None
        ),
        "validity": doc.validity,
        "visibility": doc.visibility,
        "summary": doc.summary,
        "published_at": _fmt(doc.published_at),
        "effective_from": _fmt(doc.effective_from),
    }


async def get_document_catalog_by_user(
        session: AsyncSession,
        *,
        user_id: int,
        include_archive: bool = False,
        limit: int = 200,
) -> List[Dict[str, Any]]:
    """
    根据登录用户 id，查询该用户可见的文档目录。
    返回结构与 document_catalog JSON 一致，可直接给 AI 匹配。
    """
    # ---------- 1. 查用户 ----------
    user_stmt = select(User).where(
        User.id == user_id,
        User.deleted_at.is_(None),
        User.is_active.is_(True),
    )
    user = (await session.execute(user_stmt)).scalar_one_or_none()
    if user is None:
        raise ValueError(f"用户不存在或已禁用: user_id={user_id}")

    user_role = user.role
    user_org_id = user.organization_id

    # ---------- 2. 根据角色确定 visibility 白名单 ----------
    role_visibility = {
        "student": ["public", "campus", "student"],
        "teacher": ["public", "campus", "student", "teacher"],
        "admin": ["public", "campus", "student", "teacher", "department", "admin"],
    }
    allowed = role_visibility.get(user_role, ["public", "campus"])

    # department 可见范围：只有本组织可看
    if user_org_id is not None:
        visibility_condition = or_(
            KnowledgeDocument.visibility.in_(allowed),
            and_(
                KnowledgeDocument.visibility == "department",
                KnowledgeDocument.issuer_organization_id == user_org_id,
            ),
        )
    else:
        visibility_condition = KnowledgeDocument.visibility.in_(allowed)

    # ---------- 3. 查文档 ----------
    stmt = (
        select(KnowledgeDocument)
        .options(
            selectinload(KnowledgeDocument.category),
            selectinload(KnowledgeDocument.issuer_organization),
        )
        .where(
            KnowledgeDocument.deleted_at.is_(None),
            KnowledgeDocument.status == "ready",
            visibility_condition,
        )
        .order_by(KnowledgeDocument.published_at.desc())
        .limit(limit)
    )

    if not include_archive:
        stmt = stmt.where(
            KnowledgeDocument.validity.in_(["current", "revised"])
        )

    result = await session.execute(stmt)
    docs = result.scalars().all()

    return [_row_to_dict(d) for d in docs]


async def get_tasks_document_match_to_llm(title: str, session: AsyncSession, user_id: int):
    document_catalog = await get_document_catalog_by_user(session=session, user_id=user_id)

    message = FILE_MATCH_PROMPT.invoke({"user_query": title, "document_catalog": document_catalog})
    # 打 internal 标签：万一将来在对话图内被调用，token 不会混进给用户的回答流
    res = model.invoke(message, config={"tags": ["internal"]})
    return result.success(data={
        "items": json.loads(res.content)
    })

async def get_all_templates_catalog(session: AsyncSession) -> List[Dict[str, Any]]:
    """
    异步查询三张表，并按照指定的 JSON 结构封装返回。
    """
    # 1. 构建查询语句
    # 使用 selectinload 预加载 steps 和 requirements，避免异步下的 N+1 查询
    stmt = (
        select(TaskTemplate)
        .options(
            selectinload(TaskTemplate.steps),
            selectinload(TaskTemplate.requirements)
        )
        .where(TaskTemplate.is_active == True)  # 只查启用的模板
        .order_by(TaskTemplate.id)  # 按创建顺序排序
    )

    # 2. 执行查询
    result = await session.execute(stmt)
    templates = result.scalars().all()

    # 3. 序列化封装
    catalog = []
    for tpl in templates:
        # 对 steps 排序 (按 step_order)
        sorted_steps = sorted(tpl.steps, key=lambda x: x.step_order)
        # 对 requirements 排序 (按 sort_order)
        sorted_reqs = sorted(tpl.requirements, key=lambda x: x.sort_order)

        # 构造与 JSON 完全一致的结构
        tpl_dict = {
            "template_id": tpl.id,
            "template_key": tpl.template_key,
            "name": tpl.name,
            "description": tpl.description,
            # 注意：你提供的 JSON 中 id 是字符串 "12"，这里做了兼容转换
            "responsible_organization_id": str(
                tpl.responsible_organization_id) if tpl.responsible_organization_id is not None else None,
            "form_schema": tpl.form_schema,
            "steps": [
                {
                    "step_id": step.id,
                    "step_order": step.step_order,
                    "organization_id": step.organization_id,
                    "name": step.name,
                    "requires_user_action": step.requires_user_action
                }
                for step in sorted_steps
            ],
            "requirements": [
                {
                    "requirement_key": req.requirement_key,
                    "name": req.name,
                    "allowed_content_types": req.allowed_content_types,
                    "max_size_bytes": req.max_size_bytes,
                    "is_required": req.is_required
                }
                for req in sorted_reqs
            ]
        }
        catalog.append(tpl_dict)

    return catalog
