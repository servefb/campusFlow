from sqlalchemy import (
    Column, BigInteger, String, Text, JSON, Boolean, Integer, SmallInteger,
    DateTime, ForeignKey, UniqueConstraint, func
)
from sqlalchemy.orm import relationship

from src.db.db_base import Base


class TaskTemplate(Base):
    """任务模板表 (task_templates)"""
    __tablename__ = 'task_templates'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    template_key = Column(String(80), unique=True, nullable=False, comment="模板唯一标识")
    name = Column(String(160), nullable=False, comment="模板名称")
    responsible_organization_id = Column(BigInteger, nullable=True, comment="负责机构ID")
    description = Column(Text, nullable=True, comment="模板描述")
    form_schema = Column(JSON, nullable=False, default=dict, comment="表单结构定义")
    version = Column(Integer, nullable=False, default=1, comment="版本号")
    is_active = Column(Boolean, nullable=False, default=True, comment="是否启用")
    created_at = Column(DateTime(3), nullable=False, server_default=func.now(3))
    updated_at = Column(DateTime(3), nullable=False, server_default=func.now(3), onupdate=func.now(3))

    # 关系映射
    steps = relationship("TaskTemplateStep", back_populates="template", cascade="all, delete-orphan")
    requirements = relationship("TaskTemplateRequirement", back_populates="template", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<TaskTemplate(key='{self.template_key}', name='{self.name}')>"


class TaskTemplateStep(Base):
    """任务模板步骤表 (task_template_steps)"""
    __tablename__ = 'task_template_steps'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    template_id = Column(BigInteger, ForeignKey('task_templates.id'), nullable=False)
    step_order = Column(SmallInteger, nullable=False, comment="步骤顺序")
    name = Column(String(160), nullable=False, comment="步骤名称")
    organization_id = Column(BigInteger, nullable=True, comment="负责机构ID")
    expected_minutes = Column(Integer, nullable=True, comment="预计耗时(分钟)")
    requires_user_action = Column(Boolean, nullable=False, default=False, comment="是否需要用户操作")
    config = Column(JSON, nullable=False, default=dict, comment="额外配置")

    # 关系映射
    template = relationship("TaskTemplate", back_populates="steps")

    __table_args__ = (
        UniqueConstraint('template_id', 'step_order', name='uq_template_step_order'),
    )

    def __repr__(self):
        return f"<TaskTemplateStep(template_id={self.template_id}, order={self.step_order}, name='{self.name}')>"


class TaskTemplateRequirement(Base):
    """任务模板材料要求表 (task_template_requirements)"""
    __tablename__ = 'task_template_requirements'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    template_id = Column(BigInteger, ForeignKey('task_templates.id'), nullable=False)
    requirement_key = Column(String(80), nullable=False, comment="材料唯一标识")
    name = Column(String(180), nullable=False, comment="材料名称")
    description = Column(Text, nullable=True, comment="材料说明")
    allowed_content_types = Column(JSON, nullable=False, default=list, comment="允许的文件类型")
    max_size_bytes = Column(BigInteger, nullable=True, comment="最大文件大小")
    is_required = Column(Boolean, nullable=False, default=True, comment="是否必须")
    validation_rule = Column(JSON, nullable=False, default=dict, comment="校验规则")
    sort_order = Column(Integer, nullable=False, default=0, comment="排序")

    # 关系映射
    template = relationship("TaskTemplate", back_populates="requirements")

    __table_args__ = (
        UniqueConstraint('template_id', 'requirement_key', name='uq_template_req_key'),
    )

    def __repr__(self):
        return f"<TaskTemplateRequirement(template_id={self.template_id}, key='{self.requirement_key}')>"