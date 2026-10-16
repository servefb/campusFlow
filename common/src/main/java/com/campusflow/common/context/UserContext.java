package com.campusflow.common.context;

public final class UserContext {
    private static final ThreadLocal<Long> CURRENT_USER = new ThreadLocal<>();
    private UserContext() {}
    public static void setUserId(Long userId) { CURRENT_USER.set(userId); }
    public static Long getUserId() { return CURRENT_USER.get(); }
    public static void clear() { CURRENT_USER.remove(); }
}
