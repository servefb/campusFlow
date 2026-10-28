package com.campusflow.service.support;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.campusflow.common.context.UserContext;
import com.campusflow.common.exception.BusinessException;
import com.campusflow.service.entity.po.UserRoles;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.mapper.UserRolesMapper;
import com.campusflow.service.mapper.UsersMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 「这个请求必须是管理员」的<b>唯一</b>判断点。
 *
 * <h3>为什么要有这个类</h3>
 * {@code JwtInterceptor} 只把 {@code userId} 塞进 {@link UserContext}，token 里<b>没有角色</b>
 * （见 {@code UsersServiceImpl#login}），全工程也没有 {@code /admin/**} 的角色拦截器。
 * 于是每个 {@code /admin/*} 服务实现都要自己回查一次 {@code users.role}。
 * 在 {@code AdminMetricsServiceImpl} 里这段代码原本是私有方法，注释已经写明「后续接口落地时
 * 应该抽成公共组件，不要每个实现类抄一份」—— 本轮 {@code /admin/users/*}、{@code /admin/roles/*}、
 * {@code /admin/reviews/*} 一起上，正好到了必须抽的时候。
 *
 * <h3>为什么回查库而不是信 token</h3>
 * 角色没进 claim，回查是唯一的办法；好处是<b>降权立即生效</b>，不必等旧 token 过期。
 * 代价是每个管理端请求多一次主键查询 —— 这个代价换掉「令牌里揣着一个过期角色」是值得的。
 *
 * <h3>403 的文案为什么不分细</h3>
 * 「用户不存在」与「不是管理员」统一回同一句话，避免拿管理端接口当用户 id 探测器。
 *
 * @author JIA
 * @since 2026-09-23
 */
@Component
@RequiredArgsConstructor
public class AdminGuard {

    /** 管理员角色值，对应 {@code users.role} 枚举 {@code enum('student','teacher','admin')}。 */
    public static final String ROLE_ADMIN = "admin";

    /** 超级管理员的管理端角色标识，对应 {@code roles.role_key}。 */
    public static final String SUPER_ADMIN_KEY = "super_admin";

    private final UsersMapper usersMapper;

    private final UserRolesMapper userRolesMapper;

    /**
     * 校验当前登录用户是管理员，否则抛 403。
     *
     * @return 当前管理员用户实体（调用方常要它的 id 记审计），非空
     * @throws BusinessException code=403 未登录或非管理员
     */
    public Users requireAdmin() {
        Long userId = UserContext.getUserId();
        Users user = userId == null ? null : usersMapper.selectById(userId);
        if (user == null || !ROLE_ADMIN.equalsIgnoreCase(user.getRole())) {
            throw new BusinessException(403, "需要管理员权限");
        }
        return user;
    }

    /**
     * 需要「超级管理员」级别的高危操作（如重置权限矩阵）时用这个。
     *
     * <p>判断依据是 {@code user_roles.role_key='super_admin'}，<b>不是</b> {@code users.role}——
     * 后者只有粗粒度的 admin，区分不出超管。缺 {@code user_roles} 行时按「无该角色」处理。
     *
     * @param admin 已经过 {@link #requireAdmin()} 的用户
     */
    public void requireSuperAdmin(Users admin) {
        Long count = userRolesMapper.selectCount(new LambdaQueryWrapper<UserRoles>()
                .eq(UserRoles::getUserId, admin.getId())
                .eq(UserRoles::getRoleKey, SUPER_ADMIN_KEY));
        if (count == null || count == 0L) {
            throw new BusinessException(403, "该操作需要超级管理员权限");
        }
    }
}
