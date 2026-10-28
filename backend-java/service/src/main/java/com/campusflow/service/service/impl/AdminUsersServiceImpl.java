package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.common.context.AuditContext;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.exception.NotFoundException;
import com.campusflow.common.response.Result;
import com.campusflow.service.aspect.MyLog;
import com.campusflow.service.entity.dto.AdminUserBatchDto;
import com.campusflow.service.entity.dto.AdminUserCreateDto;
import com.campusflow.service.entity.dto.AdminUserQueryDto;
import com.campusflow.service.entity.dto.AdminUserUpdateDto;
import com.campusflow.service.entity.po.Roles;
import com.campusflow.service.entity.po.UserRoles;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.vo.AdminUserVo;
import com.campusflow.service.entity.vo.UserStatsVo;
import com.campusflow.service.mapper.RolesMapper;
import com.campusflow.service.mapper.UserRolesMapper;
import com.campusflow.service.mapper.UsersMapper;
import com.campusflow.service.service.IAdminUsersService;
import com.campusflow.service.support.AdminGuard;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 管理端用户与角色实现（{@code /admin/users*}）。
 *
 * <h3>「用户列表」到底列的是谁</h3>
 * 全量用户（{@code deleted_at IS NULL}），<b>不是</b>只列管理员。依据是页面的两处文案：
 * 表脚写「共 N 位校园用户账号」、页头 lede 写「管理高校师生账号状态」，
 * 且「校园用户总数」与列表 {@code total} 是同一个口径。没有管理端角色的行
 * {@code role_name} 为空、前端渲染「—」—— 这才是「这人没有后台权限」的正确表达，
 * 而不是把他从列表里藏掉（藏掉之后管理员根本没法给他授权）。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AdminUsersServiceImpl extends ServiceImpl<UsersMapper, Users> implements IAdminUsersService {

    /**
     * {@code users.status} 的合法取值，与库里的 enum 一一对应。
     *
     * <p>⚠️ 校验必须放在应用层：MySQL 对 enum 列的非法值不会报错，而是往库里写一个
     * <b>空字符串</b>（严格模式下才报错，而本工程没开）—— 于是界面显示空白徽章，
     * 谁也说不清这人是什么状态。
     */
    private static final Set<String> ALLOWED_STATUS = Set.of("active", "pending", "locked", "disabled");

    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private static final int DEFAULT_PAGE = 1;
    private static final int DEFAULT_PAGE_SIZE = 8;

    /** 单页上限 —— 防止有人用 {@code page_size=999999} 把全表拉走。 */
    private static final int MAX_PAGE_SIZE = 200;

    /** 导出上限。超出部分不导，并在响应里如实说明（宁可少导，不要静默截断）。 */
    private static final int EXPORT_LIMIT = 5000;

    private final AdminGuard adminGuard;
    private final UserRolesMapper userRolesMapper;
    private final RolesMapper rolesMapper;
    private final MinioService minioService;

    @Override
    public Result<UserStatsVo> getUserStats() {
        adminGuard.requireAdmin();

        long total = count(new LambdaQueryWrapper<Users>().isNull(Users::getDeletedAt));
        LocalDateTime todayStart = LocalDate.now(ZONE).atStartOfDay();
        long activeToday = count(new LambdaQueryWrapper<Users>()
                .isNull(Users::getDeletedAt)
                .ge(Users::getLastLoginAt, todayStart));
        long pending = count(new LambdaQueryWrapper<Users>()
                .isNull(Users::getDeletedAt)
                .eq(Users::getStatus, "pending"));
        long seats = userRolesMapper.selectCount(null);

        UserStatsVo vo = new UserStatsVo();
        vo.setTotal(total);
        vo.setActive_today(activeToday);
        vo.setActive_ratio(ratio(activeToday, total));
        vo.setAdmin_seats(seats);
        vo.setAdmin_ratio(ratio(seats, total));
        vo.setPending_identity(pending);
        return new Result<UserStatsVo>().success(vo);
    }

    @Override
    public Result<BaseQueryVo<AdminUserVo>> listUsers(AdminUserQueryDto query) {
        adminGuard.requireAdmin();
        AdminUserQueryDto q = query == null ? new AdminUserQueryDto() : query;

        int pageNo = normalizePage(q.getPage());
        int pageSize = normalizePageSize(q.getPage_size());

        LambdaQueryWrapper<Users> wrapper = baseFilterWrapper(q);

        // 角色筛选：先解析出「拥有该角色的用户 id」，再作为 IN 条件。
        // ⚠️ 必须处理「一个都没有」的情况：MyBatis-Plus 的 in() 拿到空集合会渲染成
        // `IN ()`，MySQL 直接报语法错 → 前端看到 500，而真正的含义只是「没有匹配项」。
        if (hasFilter(q.getRole_key())) {
            List<Long> userIds = userIdsOfRole(q.getRole_key());
            if (userIds.isEmpty()) {
                return new Result<BaseQueryVo<AdminUserVo>>().success(emptyPage(pageNo, pageSize));
            }
            wrapper.in(Users::getId, userIds);
        }

        wrapper.orderByDesc(Users::getCreatedAt).orderByAsc(Users::getId);
        Page<Users> page = page(new Page<>(pageNo, pageSize), wrapper);

        BaseQueryVo<AdminUserVo> vo = new BaseQueryVo<>();
        vo.setItems(toVos(page.getRecords()));
        vo.setTotal(page.getTotal());
        vo.setPage(pageNo);
        vo.setPage_size(pageSize);
        vo.setHas_more(page.hasNext());
        return new Result<BaseQueryVo<AdminUserVo>>().success(vo);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    @MyLog(value = "user", description = "新建管理端账号 / 邀请管理员")
    public Result<AdminUserVo> createUser(AdminUserCreateDto payload) {
        Users admin = adminGuard.requireAdmin();
        if (payload == null) {
            throw new BusinessException(400, "请求体为空");
        }
        String name = trimToNull(payload.getName());
        String account = trimToNull(payload.getAccount());
        String email = trimToNull(payload.getEmail());
        String department = trimToNull(payload.getDepartment());
        String roleKey = trimToNull(payload.getRole_key());

        if (name == null || account == null || department == null) {
            throw new BusinessException(400, "姓名、工号/学号、归属单位均为必填");
        }
        if (email == null || !email.contains("@")) {
            throw new BusinessException(400, "校园邮箱格式不正确");
        }
        Roles role = requireRole(roleKey);

        // ⚠️ account 上的唯一索引**不含 deleted_at**（见 数据库设计.sql），
        // 所以这里要连软删的行一起查，否则会直接撞 DB 唯一键报 500，
        // 而错误信息是「Duplicate entry」这种只有运维看得懂的话。
        long sameAccount = count(new LambdaQueryWrapper<Users>().eq(Users::getAccount, account));
        if (sameAccount > 0) {
            throw new BusinessException(409, "该工号/学号已存在（可能属于一个已停用的历史账号）");
        }

        Users user = new Users()
                .setAccount(account)
                .setName(name)
                .setEmail(email)
                .setDepartmentName(department)
                // 管理端席位在粗粒度身份上都是 admin —— 细粒度权限由 user_roles 决定
                .setRole(AdminGuard.ROLE_ADMIN)
                .setStatus("pending")
                // 与 status 同步：pending 一定不可登录（见 2026-09-23-users-admin-columns.sql）
                .setIsActive(false)
                .setIdentityNote("待激活 · 邀请已发送");
        save(user);

        userRolesMapper.insert(new UserRoles()
                .setUserId(user.getId())
                .setRoleKey(role.getRoleKey())
                .setGrantedBy(admin.getId())
                .setGrantedAt(LocalDateTime.now(ZONE)));

        // 显式声明审计对象：切面不再靠反射猜 resource_id（见 AuditContext 注释）。
        // 新建时 id 只有这里才知道，所以声明点必须在 service 而不是 controller。
        AuditContext.setResource("user", user.getId());

        log.info("管理端新建账号：id={}, account={}, role={}, operator={}",
                user.getId(), account, role.getRoleKey(), admin.getId());
        return new Result<AdminUserVo>().success(toVo(user, role.getRoleKey(), role.getName()));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    @MyLog(value = "user", description = "调整账号的角色或状态")
    public Result<AdminUserVo> updateUser(Long id, AdminUserUpdateDto payload) {
        Users admin = adminGuard.requireAdmin();
        if (id == null) {
            throw new BusinessException(400, "缺少用户 id");
        }
        Users user = getById(id);
        if (user == null || user.getDeletedAt() != null) {
            throw new NotFoundException("用户不存在：" + id);
        }
        // 审计对象 = 被改的那个账号（不是操作人）。这里就是「声明点与业务对象同一个地方」的示范。
        AuditContext.setResource("user", id);
        if (payload == null) {
            throw new BusinessException(400, "请求体为空");
        }

        String targetStatus = trimToNull(payload.getStatus());
        if (targetStatus != null) {
            if (!ALLOWED_STATUS.contains(targetStatus)) {
                throw new BusinessException(400, "不支持的状态：" + targetStatus
                        + "（可选 " + String.join(" / ", ALLOWED_STATUS) + "）");
            }
            // 防自锁：管理员不能把自己冻结/锁定，否则这个后台就没人能进了
            // （没有「找回超管」的入口，出了事只能改库）。
            if (id.equals(admin.getId()) && !"active".equals(targetStatus) && !"pending".equals(targetStatus)) {
                throw new BusinessException(400, "不能停用或锁定当前登录的管理员账号");
            }
            applyStatus(user, targetStatus);
        }

        String roleKey = payload.getRole_key();
        if (roleKey != null) {
            String normalized = trimToNull(roleKey);
            if (normalized == null) {
                // 空串 = 回收管理角色（页面上的「取消授权」）。行删掉，不是置空。
                userRolesMapper.delete(new LambdaQueryWrapper<UserRoles>().eq(UserRoles::getUserId, id));
            } else {
                Roles role = requireRole(normalized);
                upsertUserRole(id, role.getRoleKey(), admin.getId());
            }
        }

        // 只更新非空字段：MyBatis-Plus 默认 NOT_NULL 策略会跳过 null 字段，
        // 所以「只改状态」的请求不会把角色、邮箱等列写空。
        updateById(user);
        return new Result<AdminUserVo>().success(toVo(user,
                currentRoleKey(id), roleNameOf(currentRoleKey(id))));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    @MyLog(value = "user", description = "批量调整账号的角色或状态")
    public Result<Map<String, Object>> batchUpdate(AdminUserBatchDto payload) {
        Users admin = adminGuard.requireAdmin();
        if (payload == null || payload.getUser_ids() == null || payload.getUser_ids().isEmpty()) {
            throw new BusinessException(400, "请选择要操作的账号");
        }
        boolean changeStatus = trimToNull(payload.getStatus()) != null;
        boolean changeRole = payload.getRole_key() != null;
        if (!changeStatus && !changeRole) {
            throw new BusinessException(400, "没有需要变更的内容（role_key 与 status 至少要给一个）");
        }

        String targetStatus = trimToNull(payload.getStatus());
        if (changeStatus && !ALLOWED_STATUS.contains(targetStatus)) {
            throw new BusinessException(400, "不支持的状态：" + targetStatus);
        }
        String roleKey = trimToNull(payload.getRole_key());
        Roles role = changeRole && roleKey != null ? requireRole(roleKey) : null;

        // 去重：前端「全选」与手动勾选叠加时会发出重复 id，重复计数会让 affected 虚高
        Set<Long> ids = new LinkedHashSet<>(payload.getUser_ids());

        int affected = 0;
        List<Long> skipped = new ArrayList<>();
        for (Long userId : ids) {
            Users user = userId == null ? null : getById(userId);
            if (user == null || user.getDeletedAt() != null) {
                skipped.add(userId);
                continue;
            }
            if (changeStatus) {
                if (userId.equals(admin.getId()) && !"active".equals(targetStatus) && !"pending".equals(targetStatus)) {
                    // 自己那一条跳过而不是整批失败 —— 批量冻结的语义是「除我之外都冻上」，
                    // 因为一个人把自己挡住让另外 30 条白做，管理员只会更困惑。
                    skipped.add(userId);
                    continue;
                }
                applyStatus(user, targetStatus);
                updateById(user);
            }
            if (changeRole) {
                if (roleKey == null) {
                    userRolesMapper.delete(new LambdaQueryWrapper<UserRoles>().eq(UserRoles::getUserId, userId));
                } else {
                    upsertUserRole(userId, role.getRoleKey(), admin.getId());
                }
            }
            affected++;
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("affected", affected);
        data.put("skipped", skipped.size());
        data.put("skipped_ids", skipped);
        return new Result<Map<String, Object>>().success(data);
    }

    @Override
    @MyLog(value = "user", description = "导出用户名单")
    public Result<Map<String, Object>> exportUsers(AdminUserQueryDto query) {
        adminGuard.requireAdmin();
        AdminUserQueryDto q = query == null ? new AdminUserQueryDto() : query;

        LambdaQueryWrapper<Users> wrapper = baseFilterWrapper(q);
        if (hasFilter(q.getRole_key())) {
            List<Long> userIds = userIdsOfRole(q.getRole_key());
            if (userIds.isEmpty()) {
                throw new BusinessException(404, "当前筛选下没有可导出的账号");
            }
            wrapper.in(Users::getId, userIds);
        }
        wrapper.orderByDesc(Users::getCreatedAt).orderByAsc(Users::getId).last("LIMIT " + EXPORT_LIMIT);
        List<Users> rows = list(wrapper);

        List<AdminUserVo> items = toVos(rows);
        byte[] csv = buildCsv(items);

        String objectName = "exports/users/" + LocalDate.now(ZONE).format(DateTimeFormatter.ofPattern("yyyyMM"))
                + "/users-" + System.currentTimeMillis() + ".csv";
        String objectKey = minioService.uploadBytes(csv, "text/csv; charset=utf-8", objectName);

        String url;
        try {
            url = minioService.getPresignedGetUrl(objectKey, Duration.ofDays(7));
        } catch (Exception e) {
            // 上传成功但签名失败：如实报错，不要把空字符串当成「链接」返回给前端
            log.error("用户名单已上传但签名失败：objectKey={}", objectKey, e);
            throw new BusinessException(500, "导出文件已生成，但下载链接签名失败，请重试");
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("file_url", url);
        data.put("file_name", objectName.substring(objectName.lastIndexOf('/') + 1));
        data.put("rows", items.size());
        // 真实截断要说出来：前端文案是「导出任务已创建」，行数只有在这里能拿到
        data.put("truncated", items.size() >= EXPORT_LIMIT);
        return new Result<Map<String, Object>>().success(data);
    }

    // ------------------------------------------------------------------ 内部工具

    /**
     * 关键词 / 部门筛选的公共部分 —— 列表与导出必须用**同一个** wrapper，
     * 否则「导出的名单和页面上看到的不一样」，而这种差异没人会第一时间怀疑代码。
     */
    private LambdaQueryWrapper<Users> baseFilterWrapper(AdminUserQueryDto q) {
        LambdaQueryWrapper<Users> wrapper = new LambdaQueryWrapper<>();
        // 本工程没有 @TableLogic，软删不会自动过滤，必须显式写
        wrapper.isNull(Users::getDeletedAt);
        String keyword = trimToNull(q.getKeyword());
        if (keyword != null) {
            wrapper.and(w -> w.like(Users::getName, keyword)
                    .or().like(Users::getAccount, keyword)
                    .or().like(Users::getEmail, keyword));
        }
        if (hasFilter(q.getDepartment())) {
            wrapper.eq(Users::getDepartmentName, q.getDepartment().trim());
        }
        return wrapper;
    }

    /** 「全部」哨兵与空串都不算筛选条件 —— 把 `all` 当值去精确匹配必然 0 行。 */
    private static boolean hasFilter(String value) {
        return value != null && !value.isBlank() && !"all".equalsIgnoreCase(value.trim());
    }

    private List<Long> userIdsOfRole(String roleKey) {
        return userRolesMapper.selectList(new LambdaQueryWrapper<UserRoles>().eq(UserRoles::getRoleKey, roleKey.trim()))
                .stream().map(UserRoles::getUserId).filter(java.util.Objects::nonNull).distinct().toList();
    }

    /**
     * 状态与 {@code is_active} 的同步点 —— <b>唯一</b>允许同时改这两个字段的地方。
     */
    private static void applyStatus(Users user, String status) {
        user.setStatus(status);
        user.setIsActive("active".equals(status));
        if ("disabled".equals(status)) {
            user.setIdentityNote("账号已停用");
        } else if ("locked".equals(status)) {
            user.setIdentityNote("登录锁定 · 待安全复核");
        } else if ("pending".equals(status)) {
            user.setIdentityNote("待激活 · 等待身份核验");
        } else if ("active".equals(status)) {
            user.setIdentityNote("普通身份");
        }
    }

    private void upsertUserRole(Long userId, String roleKey, Long operatorId) {
        UserRoles existing = userRolesMapper.selectOne(
                new LambdaQueryWrapper<UserRoles>().eq(UserRoles::getUserId, userId));
        if (existing == null) {
            userRolesMapper.insert(new UserRoles()
                    .setUserId(userId).setRoleKey(roleKey)
                    .setGrantedBy(operatorId).setGrantedAt(LocalDateTime.now(ZONE)));
        } else if (!roleKey.equals(existing.getRoleKey())) {
            existing.setRoleKey(roleKey).setGrantedBy(operatorId).setGrantedAt(LocalDateTime.now(ZONE));
            userRolesMapper.updateById(existing);
        }
        // 角色没变就原地不动：granted_at / granted_by 表示「谁在什么时候给的」，
        // 重复点一次保存不该把授权时间刷成现在，否则审计轨迹失去意义。
    }

    private Roles requireRole(String roleKey) {
        if (roleKey == null) {
            throw new BusinessException(400, "请选择管理端角色");
        }
        Roles role = rolesMapper.selectOne(new LambdaQueryWrapper<Roles>().eq(Roles::getRoleKey, roleKey));
        if (role == null) {
            // 不静默兜到某个默认角色：兜底会让「授权失败」看起来像成功
            throw new BusinessException(400, "角色不存在：" + roleKey);
        }
        return role;
    }

    private String currentRoleKey(Long userId) {
        List<UserRoles> rows = userRolesMapper.selectList(
                new LambdaQueryWrapper<UserRoles>().eq(UserRoles::getUserId, userId));
        return rows.isEmpty() ? null : rows.get(0).getRoleKey();
    }

    private String roleNameOf(String roleKey) {
        if (roleKey == null) {
            return null;
        }
        Roles role = rolesMapper.selectOne(new LambdaQueryWrapper<Roles>().eq(Roles::getRoleKey, roleKey));
        return role == null ? null : role.getName();
    }

    private List<AdminUserVo> toVos(List<Users> users) {
        if (users == null || users.isEmpty()) {
            return List.of();
        }
        List<Long> ids = users.stream().map(Users::getId).toList();

        Map<Long, String> roleKeyByUser = userRolesMapper.selectList(
                        new LambdaQueryWrapper<UserRoles>().in(UserRoles::getUserId, ids))
                .stream()
                // 同一用户多行时取第一条（表上有唯一键，正常情况不会出现；防御性写法）
                .collect(Collectors.toMap(UserRoles::getUserId, UserRoles::getRoleKey, (a, b) -> a));

        Map<String, String> roleNameByKey = rolesMapper.selectList(null).stream()
                .collect(Collectors.toMap(Roles::getRoleKey, Roles::getName, (a, b) -> a));

        return users.stream().map(user -> {
            String roleKey = roleKeyByUser.get(user.getId());
            return toVo(user, roleKey, roleKey == null ? null : roleNameByKey.get(roleKey));
        }).toList();
    }

    private AdminUserVo toVo(Users user, String roleKey, String roleName) {
        AdminUserVo vo = new AdminUserVo();
        vo.setId(user.getId());
        vo.setName(user.getName());
        vo.setAccount(user.getAccount());
        vo.setEmail(user.getEmail());
        vo.setDepartment(user.getDepartmentName());
        vo.setRole_key(roleKey);
        vo.setRole_name(roleName);
        // status 为 null 时回落到 active：这一列有 NOT NULL DEFAULT，null 只可能出现在
        // 尚未重跑的旧数据快照里；回落到「启用」与 DB 默认值一致，不是编造。
        vo.setStatus(user.getStatus() == null ? "active" : user.getStatus());
        vo.setLast_login_at(user.getLastLoginAt() == null ? null : user.getLastLoginAt().toString());
        vo.setLast_login_ip(user.getLastLoginIp());
        vo.setNetwork(user.getNetwork());
        vo.setIdentity_note(user.getIdentityNote());
        return vo;
    }

    private static int normalizePage(Integer page) {
        return page == null || page < 1 ? DEFAULT_PAGE : page;
    }

    private static int normalizePageSize(Integer pageSize) {
        if (pageSize == null || pageSize < 1) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.min(pageSize, MAX_PAGE_SIZE);
    }

    private static BaseQueryVo<AdminUserVo> emptyPage(int pageNo, int pageSize) {
        return new BaseQueryVo<>(new ArrayList<>(), 0L, pageNo, pageSize, false);
    }

    private static double ratio(long part, long total) {
        // 分母为 0 时返回 0.0 而不是 NaN：NaN 不是合法 JSON，axios 解析会直接抛错，
        // 症状是「接口挂了」，而真相只是「还没有用户」。
        return total <= 0 ? 0d : (double) part / (double) total;
    }

    private static String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * 拼 CSV。带 UTF-8 BOM —— 不带的话 Excel 打开中文列名是乱码，
     * 而「导出乱码」这种问题每次都会被当成后端编码写错。
     */
    private static byte[] buildCsv(List<AdminUserVo> items) {
        StringBuilder sb = new StringBuilder();
        sb.append('\uFEFF');
        sb.append("姓名,工号/学号,邮箱,归属学院/部门,管理端角色,账号状态,最近登录,最近登录IP,登录网络\n");
        for (AdminUserVo item : items) {
            sb.append(csvCell(item.getName())).append(',')
                    .append(csvCell(item.getAccount())).append(',')
                    .append(csvCell(item.getEmail())).append(',')
                    .append(csvCell(item.getDepartment())).append(',')
                    .append(csvCell(item.getRole_name())).append(',')
                    .append(csvCell(STATUS_LABEL.getOrDefault(item.getStatus(), item.getStatus()))).append(',')
                    .append(csvCell(item.getLast_login_at())).append(',')
                    .append(csvCell(item.getLast_login_ip())).append(',')
                    .append(csvCell(item.getNetwork())).append('\n');
        }
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    /** 状态中文名 —— 只用于导出文件（界面上的译名在前端字典里）。 */
    private static final Map<String, String> STATUS_LABEL = Map.of(
            "active", "正常",
            "pending", "待激活",
            "locked", "已锁定",
            "disabled", "已停用");

    /**
     * CSV 单元格转义。
     *
     * <p>必要规则：含逗号 / 引号 / 换行的值必须用双引号包起来，内部引号翻倍。
     * 少一条就会出现「一个部门的逗号把整行拆成两列」—— 导出文件在 Excel 里看着就是错位，
     * 而源头是不可见的分隔符。
     */
    private static String csvCell(String value) {
        if (value == null) {
            return "";
        }
        boolean needQuote = value.indexOf(',') >= 0 || value.indexOf('"') >= 0
                || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0;
        String escaped = value.replace("\"", "\"\"");
        return needQuote ? "\"" + escaped + "\"" : escaped;
    }
}
