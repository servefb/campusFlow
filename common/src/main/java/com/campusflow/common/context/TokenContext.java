package com.campusflow.common.context;

public class TokenContext {
    private static final ThreadLocal<String> TOKEN = new ThreadLocal<>();

    public static void setToken(String token) { TOKEN.set(token); }
    public static String getToken() { return TOKEN.get(); }
    public static void clear() { TOKEN.remove(); }
}