package com.campusflow.tools.interceptor;

import com.campusflow.common.context.TokenContext;
import com.campusflow.common.context.UserContext;
import com.campusflow.tools.jwtutils.JwtUtil;
import io.jsonwebtoken.Claims;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.Date;

@Component
public class JwtInterceptor implements HandlerInterceptor {
    @Autowired
    private JwtUtil jwtUtil;

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) throws Exception {
        UserContext.clear();
        TokenContext.clear();
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        // 「进入时自愈」：先清一次可能残留的上一轮值。
        // 不能只依赖下面的 afterCompletion —— preHandle 自己 return false 时，DispatcherServlet 的
        // interceptorIndex 还没前移，triggerAfterCompletion 不会回调到本拦截器；而 setToken 之后
        // 有两条 return false（token 解析失败 / 已过期），那两条路径上 afterCompletion 永不执行，
        // 脏值会随 Tomcat 复用的工作线程传给下一个请求。在入口先清一次，任何返回路径都不会留给别人。
        TokenContext.clear();
        String authorization = request.getHeader("Authorization");
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            return false;
        }
        TokenContext.setToken(authorization);
        String token = authorization.substring(7);
        Claims claims = null;
        try {
            claims = jwtUtil.extractAllClaims(token);
        } catch (Exception e) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            return false;
        }
        if (claims != null && claims.getExpiration().before(new Date())) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            return false;
        }
        if (claims != null && claims.get("userId") != null) {
            UserContext.setUserId(Long.parseLong(claims.get("userId").toString()));
        }
        return true;
    }
}
