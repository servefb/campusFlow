package com.campusflow.common.enums;

import com.baomidou.mybatisplus.annotation.EnumValue;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum ValidityEnum {
    CURRENT("current", "当前有效"),
    REVISED("revised", "已修订"),
    DEPRECATED("deprecated", "已弃用"),
    ARCHIVE("archive", "归档");

    @EnumValue          // MyBatis-Plus 用这个字段读写数据库
    @JsonValue
    private String code;
    private String message;

        // Jackson 序列化时输出这个值
    ValidityEnum(String code, String message) {
        this.code = code;
        this.message = message;
    }
    @JsonCreator        // Jackson 反序列化时用这个解析
    public static ValidityEnum fromCode(String code) {
        if (code == null || code.isBlank()) {
            return null;
        }
        for (ValidityEnum e : values()) {
            if (e.code.equalsIgnoreCase(code) || e.name().equalsIgnoreCase(code)) {
                return e;
            }
        }
        throw new IllegalArgumentException("无效的 ValidityEnum: " + code);
    }

}
