package com.campusflow.service.service.impl;

import com.campusflow.common.context.AuditContext;
import com.campusflow.common.context.UserContext;
import com.campusflow.common.response.Result;
import com.campusflow.service.aspect.MyLog;
import com.campusflow.service.entity.po.Files;
import com.campusflow.service.entity.po.UserCredentials;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.dto.loginDTO;
import com.campusflow.service.entity.dto.refreshDTO;
import com.campusflow.service.entity.vo.LoginVo;
import com.campusflow.service.entity.vo.UserVo;
import com.campusflow.service.mapper.UsersMapper;
import com.campusflow.service.service.IFilesService;
import com.campusflow.service.service.IUserCredentialsService;
import com.campusflow.service.service.IUsersService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.tools.jwtutils.JwtProperties;
import com.campusflow.tools.jwtutils.JwtUtil;
import lombok.AllArgsConstructor;
import org.mindrot.jbcrypt.BCrypt;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

/**
 * <p>
 * 服务实现类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@Service
@AllArgsConstructor
public class UsersServiceImpl extends ServiceImpl<UsersMapper, Users> implements IUsersService {

    private JwtUtil jwtUtil;
    private IUserCredentialsService userCredentialsService;
    private JwtProperties jwtProperties;
    private IFilesService filesService;
    private MinioService minioService;
    private StringRedisTemplate stringRedisTemplate;
    private final String AVATARURLKEY = "user:avatar:";

    @Override
    @MyLog(description = "进行登录操作",value = "user")
    public Result login(loginDTO loginDTO) {
        Users one = lambdaQuery().eq(Users::getAccount, loginDTO.getAccount()).one();
        if (one == null) {
            return Result.failure(404, "Account not found");
        }
        // 登录没有"被操作的资源"，但"操作人自己"就是这条记录的归属对象：
        // resource_type=user（来自 @MyLog.value）+ resource_id=登录者 id。
        // 显式声明取代原先靠反射从 LoginVo.user 里猜 —— 那正是"取错"的高发点。
        AuditContext.setResource(one.getId());
        UserCredentials userCredentials = userCredentialsService.lambdaQuery().eq(UserCredentials::getUserId, one.getId()).one();
        String passwordHash = userCredentials.getPasswordHash();
        Map<String, Object> claim = new HashMap<>();
        claim.put("userId", one.getId());
        if (BCrypt.checkpw(loginDTO.getPassword(), passwordHash)) {
            String token = jwtUtil.createToken(withTyp(claim, "access"), jwtProperties.getExpirationSeconds());
            LoginVo loginVo = new LoginVo();
            loginVo.setUser(one);
            loginVo.setAccess_token(token);
            loginVo.setExpires_in((long) jwtProperties.getExpirationSeconds());
            // 与 access token 的 typ 区分开：/auth/refresh 只认 typ=refresh（或历史版本无 typ 的旧令牌），
            // 防止把 access token 当 refresh token 用。
            loginVo.setRefresh_token(jwtUtil.createToken(withTyp(claim, "refresh"),
                    jwtProperties.getExpirationSeconds() + 2000));
            return new Result().success(loginVo);
        } else {
            return Result.failure(401, "密码错误请重试");
        }
    }

    /**
     * 刷新令牌（接口文档 A.1.2 `POST /auth/refresh`）。
     * 校验 refresh token 的签名与有效期，通过后轮换签发一对新的 access/refresh token。
     * 当前会话是无状态 JWT（登录时并未落 user_sessions），所以这里保持同一口径：
     * 只验令牌本身，不查会话表；未带 typ 的历史旧令牌也放行，避免已登录用户被迫重登一次。
     */
    @Override
    public Result refresh(refreshDTO refreshDTO) {
        if (refreshDTO == null || refreshDTO.getRefresh_token() == null || refreshDTO.getRefresh_token().isBlank()) {
            return Result.failure(400, "refresh_token is required");
        }
        io.jsonwebtoken.Claims claims;
        try {
            claims = jwtUtil.extractAllClaims(refreshDTO.getRefresh_token());
        } catch (Exception e) {
            // 签名不对 / 已过期 / 格式非法，统一按 401 处理，前端收到后走重新登录
            return Result.failure(401, "Invalid or expired refresh token");
        }
        if (claims.getExpiration() != null && claims.getExpiration().before(new Date())) {
            return Result.failure(401, "Invalid or expired refresh token");
        }
        Object typ = claims.get("typ");
        if (typ != null && !"refresh".equals(typ.toString())) {
            // 新版 access token 带 typ=access，不允许拿来刷新
            return Result.failure(401, "Invalid or expired refresh token");
        }
        Object userId = claims.get("userId");
        if (userId == null) {
            return Result.failure(401, "Invalid or expired refresh token");
        }
        Users user = getById(Long.parseLong(userId.toString()));
        if (user == null) {
            return Result.failure(401, "Account not found");
        }
        Map<String, Object> base = new HashMap<>();
        base.put("userId", user.getId());
        LoginVo loginVo = new LoginVo();
        loginVo.setAccess_token(jwtUtil.createToken(withTyp(base, "access"), jwtProperties.getExpirationSeconds()));
        loginVo.setExpires_in((long) jwtProperties.getExpirationSeconds());
        loginVo.setRefresh_token(jwtUtil.createToken(withTyp(base, "refresh"),
                jwtProperties.getExpirationSeconds() + 2000));
        return new Result().success(loginVo);
    }

    /** 在原有 claims 基础上补 typ 字段（access / refresh），不改动入参 map。 */
    private Map<String, Object> withTyp(Map<String, Object> claims, String typ) {
        Map<String, Object> merged = new HashMap<>(claims);
        merged.put("typ", typ);
        return merged;
    }

    @Override
    public Result<UserVo> getMe() {
        Long userId = UserContext.getUserId();
        Users users = getById(userId);
        UserVo userVo = new UserVo();
        userVo.setId(String.valueOf(users.getId()));
        userVo.setAccount(users.getAccount());
        userVo.setName(users.getName());
        userVo.setRole(users.getRole());
        userVo.setDepartment(users.getDepartmentName());
        Files byId = filesService.getById(users.getAvatarFileId());
        try {
            String key = AVATARURLKEY + userId;
            String url = stringRedisTemplate.opsForValue().get(key);
            if (url != null) {
                userVo.setAvatar_url(url);
            } else {
                String presignedGetUrl = minioService.getPresignedGetUrl(byId.getObjectKey(), Duration.ofDays(7));
                stringRedisTemplate.opsForValue().set(key, url = presignedGetUrl.split("\\?")[0]);
                stringRedisTemplate.expire(key, Duration.ofDays(7));
                userVo.setAvatar_url(url);
            }
        } catch (Exception e) {
            return Result.failure(500, "Failed to generate presigned URL");
        } finally {
            return new Result<UserVo>().success(userVo);
        }

    }
}
