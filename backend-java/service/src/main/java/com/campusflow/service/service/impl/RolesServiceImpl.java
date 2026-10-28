package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.common.exception.BusinessException;
import com.campusflow.common.response.Result;
import com.campusflow.service.aspect.MyLog;
import com.campusflow.service.entity.po.RolePermissions;
import com.campusflow.service.entity.po.Roles;
import com.campusflow.service.entity.po.UserRoles;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.vo.AdminRoleVo;
import com.campusflow.service.entity.vo.RoleMatrixVo;
import com.campusflow.service.mapper.RolePermissionsMapper;
import com.campusflow.service.mapper.RolesMapper;
import com.campusflow.service.mapper.UserRolesMapper;
import com.campusflow.service.service.IRolesService;
import com.campusflow.service.support.AdminGuard;
import com.campusflow.service.support.PermissionCatalog;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 管理端角色与权限矩阵实现。
 *
 * <h3>为什么 {@code member_count} 要实时算</h3>
 * 它是 {@code user_roles} 的聚合结果。落成 {@code roles} 表的一列，
 * 就一定会出现「改了用户角色、忘了刷新计数」的漂移；而「角色卡片写 6 人、
 * 用户列表里只有 4 个人挂这个角色」这种矛盾，排查起来要横跨两张表两套代码。
 * 一次 {@code GROUP BY} 换掉这类问题，值。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RolesServiceImpl extends ServiceImpl<RolesMapper, Roles> implements IRolesService {

    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private final AdminGuard adminGuard;
    private final RolePermissionsMapper rolePermissionsMapper;
    private final UserRolesMapper userRolesMapper;

    /**
     * 策略版本号。取自配置而不是写死：它表示「这套权限矩阵是哪一版策略」，
     * 改策略时要递增，而递增是配置变更，不该靠改代码重新部署。
     */
    @Value("${campus-flow.rbac.policy-version:RBAC-POLICY-V1}")
    private String policyVersion;

    @Override
    public Result<Map<String, Object>> listRoles() {
        adminGuard.requireAdmin();

        List<Roles> roles = list(new LambdaQueryWrapper<Roles>()
                .orderByAsc(Roles::getSortOrder).orderByAsc(Roles::getId));

        // 成员数一次聚合：roles 表只有几行、user_roles 行数等于后台席位数，
        // 不存在性能问题，不必为它做缓存（缓存只会带来「数据变了数字没变」）。
        Map<String, Long> memberCount = new LinkedHashMap<>();
        for (UserRoles row : userRolesMapper.selectList(null)) {
            memberCount.merge(row.getRoleKey(), 1L, Long::sum);
        }

        List<AdminRoleVo> items = new ArrayList<>();
        for (Roles role : roles) {
            AdminRoleVo vo = new AdminRoleVo();
            vo.setKey(role.getRoleKey());
            vo.setName(role.getName());
            vo.setKind(role.getKind());
            vo.setMember_count(memberCount.getOrDefault(role.getRoleKey(), 0L));
            vo.setDescription(role.getDescription());
            vo.setCapabilities(parseCapabilities(role.getCapabilities()));
            vo.setScope_note(role.getScopeNote());
            vo.setSort_order(role.getSortOrder());
            items.add(vo);
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("items", items);
        data.put("policy_version", policyVersion);
        data.put("updated_at", now());
        return new Result<Map<String, Object>>().success(data);
    }

    @Override
    public Result<RoleMatrixVo> getMatrix() {
        adminGuard.requireAdmin();

        // 权限键 → 允许的角色集合。只认 allowed=1：「有行」不等于「已授权」
        // （allowed=false 的行是显式收回，别把它读成授权）。
        Map<String, Set<String>> rolesByPermission = new LinkedHashMap<>();
        for (RolePermissions row : rolePermissionsMapper.selectList(null)) {
            if (Boolean.TRUE.equals(row.getAllowed())) {
                rolesByPermission.computeIfAbsent(row.getPermissionKey(), key -> new LinkedHashSet<>())
                        .add(row.getRoleKey());
            }
        }

        List<RoleMatrixVo.Permission> permissions = new ArrayList<>();
        for (PermissionCatalog.Permission definition : PermissionCatalog.ALL) {
            RoleMatrixVo.Permission item = new RoleMatrixVo.Permission();
            item.setKey(definition.key());
            item.setName(definition.name());
            item.setGroup(definition.group());
            item.setRoles(new ArrayList<>(rolesByPermission.getOrDefault(definition.key(), Set.of())));
            permissions.add(item);
        }

        RoleMatrixVo vo = new RoleMatrixVo();
        vo.setUpdated_at(now());
        vo.setPolicy_version(policyVersion);
        vo.setPermissions(permissions);
        return new Result<RoleMatrixVo>().success(vo);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    @MyLog(value = "role", description = "更新权限矩阵")
    public Result<Map<String, Object>> updateMatrix(RoleMatrixVo payload) {
        Users admin = adminGuard.requireAdmin();
        // 矩阵等于「谁能干什么」，能改它的只有超管。普通 admin（比如只挂了内容审核员）
        // 进了后台也不该能给自己加权限 —— 这是本页最需要挡住的一条提权路径。
        adminGuard.requireSuperAdmin(admin);

        if (payload == null || payload.getPermissions() == null || payload.getPermissions().isEmpty()) {
            throw new BusinessException(400, "权限矩阵为空：请提交至少一项权限的勾选状态");
        }

        Set<String> validRoleKeys = list().stream().map(Roles::getRoleKey).collect(Collectors.toSet());
        int touched = 0;

        for (RoleMatrixVo.Permission item : payload.getPermissions()) {
            String permissionKey = item.getKey() == null ? null : item.getKey().trim();
            if (permissionKey == null || !PermissionCatalog.KEYS.contains(permissionKey)) {
                // 不认识的权限键直接拒绝：静默忽略会让前端以为「改成功了」，
                // 而实际上那条勾选没有落库（下一次刷新就变回去）。
                throw new BusinessException(400, "未知权限：" + item.getKey());
            }
            Set<String> desired = item.getRoles() == null ? Set.of() : new LinkedHashSet<>(item.getRoles());
            for (String roleKey : desired) {
                if (!validRoleKeys.contains(roleKey)) {
                    throw new BusinessException(400, "未知角色：" + roleKey);
                }
            }

            Map<String, RolePermissions> existing = new LinkedHashMap<>();
            for (RolePermissions row : rolePermissionsMapper.selectList(
                    new LambdaQueryWrapper<RolePermissions>().eq(RolePermissions::getPermissionKey, permissionKey))) {
                existing.put(row.getRoleKey(), row);
            }

            for (String roleKey : validRoleKeys) {
                boolean allow = desired.contains(roleKey);
                RolePermissions row = existing.remove(roleKey);
                if (row == null) {
                    // 只写「授权」行；未授权的角色不留空行（表会因此长出一堆 allowed=0 的噪声行）
                    if (allow) {
                        rolePermissionsMapper.insert(new RolePermissions()
                                .setRoleKey(roleKey)
                                .setPermissionKey(permissionKey)
                                .setAllowed(true)
                                .setUpdatedBy(admin.getId())
                                .setUpdatedAt(LocalDateTime.now(ZONE)));
                    }
                    continue;
                }
                if (Boolean.TRUE.equals(row.getAllowed()) != allow) {
                    if (allow) {
                        row.setAllowed(true).setUpdatedBy(admin.getId()).setUpdatedAt(LocalDateTime.now(ZONE));
                        rolePermissionsMapper.updateById(row);
                    } else {
                        // 收回 = 删行。留一行 allowed=0 也行，但会让「这个角色有哪些权限」
                        // 这类查询必须每次都记得带 allowed=1（漏一次就把收回的权限当成了授权）。
                        rolePermissionsMapper.deleteById(row.getId());
                    }
                }
            }
            touched++;
        }

        log.info("权限矩阵已更新：涉及 {} 项权限，操作人={}", touched, admin.getId());
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("updated_at", now());
        data.put("policy_version", policyVersion);
        data.put("permissions", touched);
        return new Result<Map<String, Object>>().success(data);
    }

    // ------------------------------------------------------------------ 内部工具

    /**
     * {@code roles.capabilities} 是 JSON 文本列（{@code ["全部 16 项特权", ...]}）。
     *
     * <p>解析失败时返回空数组而不是抛异常：这一列是纯展示字段，它坏了不该让
     * 「角色列表」整个 500（那是把装饰性问题升级成可用性问题）。
     * 但也不兜成一句"解析失败"塞进数组 —— 前端会把数组项当能力条目逐条渲染。
     */
    private static List<String> parseCapabilities(String json) {
        if (json == null || json.isBlank()) {
            return new ArrayList<>();
        }
        try {
            return CAPABILITIES_MAPPER.readValue(json, CAPABILITIES_READER);
        } catch (Exception e) {
            log.warn("roles.capabilities 不是合法 JSON 数组，按空处理：{}", json);
            return new ArrayList<>();
        }
    }

    /** 静态复用：{@code ObjectMapper} 构造昂贵（要建 Serializer/Deserializer 缓存），别每行 new 一个。 */
    private static final com.fasterxml.jackson.databind.ObjectMapper CAPABILITIES_MAPPER =
            new com.fasterxml.jackson.databind.ObjectMapper();

    private static final com.fasterxml.jackson.core.type.TypeReference<List<String>> CAPABILITIES_READER =
            new com.fasterxml.jackson.core.type.TypeReference<>() {
            };

    private static String now() {
        return OffsetDateTime.now(ZONE).truncatedTo(ChronoUnit.SECONDS).toString();
    }
}
