package com.campusflow.service.support;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.campusflow.common.constant.RoleConstant;
import com.campusflow.common.context.UserContext;
import com.campusflow.common.enums.VisibilityEnum;
import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.exception.NotFoundException;
import com.campusflow.service.entity.po.KnowledgeDocuments;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.mapper.KnowledgeDocumentsMapper;
import com.campusflow.service.mapper.UsersMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 用户侧知识库「谁可见」的<b>唯一判定点</b> —— 列表 / 详情 / 章节 / 内容 / 分类计数共用。
 *
 * <h3>语义来自检索侧，不是本类发明的</h3>
 * Python 检索模块 {@code repositories/tasks_templates_match.py#get_document_catalog_by_user}
 * 早就定义了同一张映射表（AI 匹配文档时按它过滤目录）。本类与它逐字对齐：
 * 两边不一致会出现「问 AI 能引用到、翻列表却找不到」的割裂。
 *
 * <pre>
 * student → public, campus, student
 * teacher → public, campus, student, teacher      （教师可见学生文档）
 * admin   → 全部六种
 * 其他角色 → public, campus                        （兜底，含历史脏值）
 * department → 额外条件：issuer_organization_id == users.organization_id
 * </pre>
 *
 * <h3>2026-10-15 修掉的问题</h3>
 * <ol>
 *   <li>{@code campus}（校园级）文档此前对非 admin <b>完全不可见</b> —— 旧过滤只匹配
 *       「visibility = 本人 role 或 public」，校园级文档谁都不是，谁都看不到；</li>
 *   <li>{@code department}（部门级）文档此前<b>只对 admin 可见</b> —— 旧代码没有任何
 *       组织匹配逻辑，部门文档对自己人也隐身；</li>
 *   <li>教师看不到 {@code student} 文档，与检索侧白名单不一致；</li>
 *   <li>详情 / 章节 / 内容三个接口此前<b>没有任何可见性校验</b>，凭 id 可越权读任意文档
 *       （含已软删的）—— 列表防了、详情没防，等于没防。</li>
 * </ol>
 *
 * <h3>users.role 与 visibility 是两套值域</h3>
 * {@code users.role} 只有 student / teacher / admin 三值（见 {@code AdminGuard}），
 * {@code knowledge_documents.visibility} 是六值枚举（见 {@code VisibilityEnum}）。
 * 所以不能拿 role 直接 eq 到 visibility 上 —— 被修掉的旧代码正是这么错的。
 *
 * <h3>为什么 404 不说「无权查看」</h3>
 * 不存在、已删除、不在可见范围、未上线（对普通用户）统一回同一句话，
 * 避免把接口当成资源 id 探测器。同 {@code AdminGuard} 的 403 文案策略。
 *
 * @author JIA
 * @since 2026-10-15
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class KnowledgeVisibility {

    /** 文档不存在 / 已删除 / 不可见 / 未上线（对普通用户）共用的对外文案。 */
    public static final String DOC_NOT_VISIBLE = "文档不存在或无权查看";

    /** 检索侧只认 {@code status='ready'}；普通用户浏览侧与它保持一致。 */
    private static final String DOC_STATUS_READY = "ready";

    // 字符串列名（applyQueryRaw 用）：聚合统计只能走 QueryWrapper，列名写死一处、集中引用
    private static final String COL_ID = "id";
    private static final String COL_VISIBILITY = "visibility";
    private static final String COL_ISSUER_ORGANIZATION_ID = "issuer_organization_id";

    /** 角色 → 可见的 visibility 白名单。与 Python 检索侧同款，改这里必须同步那边。 */
    private static final Map<String, Set<String>> ROLE_ALLOWED = Map.of(
            RoleConstant.ROLE_STUDENT, Set.of(
                    VisibilityEnum.PUBLIC.getCode(),
                    VisibilityEnum.CAMPUS.getCode(),
                    VisibilityEnum.STUDENT.getCode()),
            RoleConstant.ROLE_TEACHER, Set.of(
                    VisibilityEnum.PUBLIC.getCode(),
                    VisibilityEnum.CAMPUS.getCode(),
                    VisibilityEnum.STUDENT.getCode(),
                    VisibilityEnum.TEACHER.getCode()),
            RoleConstant.ROLE_ADMIN, Set.of(
                    VisibilityEnum.PUBLIC.getCode(),
                    VisibilityEnum.CAMPUS.getCode(),
                    VisibilityEnum.STUDENT.getCode(),
                    VisibilityEnum.TEACHER.getCode(),
                    VisibilityEnum.DEPARTMENT.getCode(),
                    VisibilityEnum.ADMIN.getCode()));

    /** 角色不在表内（含 null / 历史脏值）时的兜底：至少公开 + 校园。 */
    private static final Set<String> FALLBACK_ALLOWED = Set.of(
            VisibilityEnum.PUBLIC.getCode(),
            VisibilityEnum.CAMPUS.getCode());

    private final KnowledgeDocumentsMapper documentsMapper;

    private final UsersMapper usersMapper;

    /** admin 放行一切（含未上线 / 已归档文档 —— 治理侧要能看到才能处置）。 */
    public boolean isAdmin(Users user) {
        return user != null && RoleConstant.ROLE_ADMIN.equalsIgnoreCase(trim(user.getRole()));
    }

    /** 该用户可见的 visibility code 集合（不含 department 的组织匹配分支）。永不为空（user 非空时）。 */
    public Set<String> allowedCodes(Users user) {
        if (user == null) {
            return Set.of();
        }
        if (isAdmin(user)) {
            return ROLE_ALLOWED.get(RoleConstant.ROLE_ADMIN);
        }
        Set<String> codes = ROLE_ALLOWED.get(normalizeRole(user.getRole()));
        return codes == null ? FALLBACK_ALLOWED : codes;
    }

    /**
     * 用户组织 id：{@code users.organization_id} 在 PO 里是 String（生成器产物，库列是 bigint），
     * 这里归一成 Long。空串 / 非数字一律 null（按「无组织」处理）——
     * 脏数据不该把一次查询变成 500。
     */
    public Long userOrgId(Users user) {
        if (user == null) {
            return null;
        }
        String text = trim(user.getOrganizationId());
        if (text == null) {
            return null;
        }
        try {
            return Long.valueOf(text);
        } catch (NumberFormatException e) {
            log.warn("users.organization_id 非数字，按无组织处理：userId={} value={}", user.getId(), text);
            return null;
        }
    }

    /**
     * 给查询条件加上可见性约束（列表 / 分类计数用），生成：
     * {@code (visibility IN (白名单) OR (visibility = 'department' AND issuer_organization_id = 用户组织))}
     *
     * <p>整段包在 {@code and(...)} 里：裸拼的话 OR 会挣脱前面已累积的 AND 条件
     * （SQL 里 AND 优先于 OR），把「分类=教务 AND 可见」算成「可见 OR 分类=教务」。
     */
    public void applyQuery(LambdaQueryWrapper<KnowledgeDocuments> wrapper, Users user) {
        if (wrapper == null) {
            return;
        }
        Set<String> codes = allowedCodes(user);
        if (codes.isEmpty()) {
            // 正常不会走到（调用方都先 requireUser）；兜底给恒假条件，别生成 IN () 那种 SQL
            wrapper.isNull(KnowledgeDocuments::getId);
            return;
        }
        Long orgId = userOrgId(user);
        wrapper.and(w -> {
            w.in(KnowledgeDocuments::getVisibility, codes);
            if (orgId != null) {
                w.or(n -> n.eq(KnowledgeDocuments::getVisibility, VisibilityEnum.DEPARTMENT.getCode())
                        .eq(KnowledgeDocuments::getIssuerOrganizationId, orgId));
            }
        });
    }

    /**
     * 字符串列名版（给 {@code QueryWrapper} 聚合统计用）。
     *
     * <p>为什么要有两份：{@code LambdaQueryWrapper} 的 {@code select} 只收 lambda 列引用，
     * 写不了 {@code COUNT(*)} 这类原生聚合 —— 分类计数只能退回 {@code QueryWrapper}，
     * 而它认的是字符串列名。因此本方法与 {@link #applyQuery(LambdaQueryWrapper, Users)}
     * 是<b>同一语义的两种写法</b>：改可见性逻辑时两个方法必须一起改
     * （好在它们就挨在一起，漂移一眼能看到）。
     */
    public void applyQueryRaw(QueryWrapper<KnowledgeDocuments> wrapper, Users user) {
        if (wrapper == null) {
            return;
        }
        Set<String> codes = allowedCodes(user);
        if (codes.isEmpty()) {
            // 正常不会走到（调用方都先 requireUser）；兜底给恒假条件，别生成 IN () 那种 SQL
            wrapper.isNull(COL_ID);
            return;
        }
        Long orgId = userOrgId(user);
        wrapper.and(w -> {
            w.in(COL_VISIBILITY, codes);
            if (orgId != null) {
                w.or(n -> n.eq(COL_VISIBILITY, VisibilityEnum.DEPARTMENT.getCode())
                        .eq(COL_ISSUER_ORGANIZATION_ID, orgId));
            }
        });
    }

    /**
     * 单条文档判定（详情 / 章节 / 内容用）。
     *
     * <p>admin 恒真；其余按白名单，{@code department} 再看发文单位是否就是用户所在单位。
     * visibility 为 null 的文档保守地不对普通用户开放（库里 default='campus'，正常走不到）。
     */
    public boolean canSee(KnowledgeDocuments doc, Users user) {
        if (doc == null || user == null) {
            return false;
        }
        if (isAdmin(user)) {
            return true;
        }
        VisibilityEnum visibility = doc.getVisibility();
        if (visibility == null) {
            return false;
        }
        String code = visibility.getCode();
        if (allowedCodes(user).contains(code)) {
            return true;
        }
        if (VisibilityEnum.DEPARTMENT.getCode().equals(code)) {
            Long orgId = userOrgId(user);
            return orgId != null && orgId.equals(doc.getIssuerOrganizationId());
        }
        return false;
    }

    /**
     * 取当前登录用户。
     *
     * <p>{@code JwtInterceptor} 只把 userId 塞进 {@link UserContext}，不校验用户行是否还在；
     * 令牌有效但账号已注销的场景，这里统一按不存在处理。
     */
    public Users requireUser() {
        Long userId = UserContext.getUserId();
        if (userId == null) {
            throw new BusinessException(401, "未登录");
        }
        Users user = usersMapper.selectById(userId);
        if (user == null || user.getDeletedAt() != null) {
            throw new NotFoundException("用户不存在或已注销");
        }
        return user;
    }

    /**
     * 取一篇<b>当前登录用户可见</b>的文档。
     *
     * <p>不存在 / 已软删 / 不在可见范围 / 未上线（非 admin）统一 404 同一句话。
     * admin 不看上线状态 —— 治理侧要能打开一篇下线文档才能决定要不要重新上线。
     */
    public KnowledgeDocuments requireVisibleDocument(Long documentId) {
        return requireVisibleDocument(documentId, requireUser());
    }

    public KnowledgeDocuments requireVisibleDocument(Long documentId, Users user) {
        if (documentId == null) {
            throw new BusinessException(400, "缺少文档 id");
        }
        KnowledgeDocuments doc = documentsMapper.selectById(documentId);
        if (doc == null || doc.getDeletedAt() != null || !canSee(doc, user)) {
            throw new NotFoundException(DOC_NOT_VISIBLE);
        }
        if (!isAdmin(user) && !DOC_STATUS_READY.equals(doc.getStatus())) {
            throw new NotFoundException(DOC_NOT_VISIBLE);
        }
        return doc;
    }

    private static String trim(String value) {
        return value == null ? null : value.trim();
    }

    private static String normalizeRole(String role) {
        String trimmed = trim(role);
        return trimmed == null ? null : trimmed.toLowerCase(Locale.ROOT);
    }
}
