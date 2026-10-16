package com.campusflow.common.enums;

import com.baomidou.mybatisplus.annotation.EnumValue;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum VisibilityEnum {
//    enum('public', 'campus', 'student', 'teacher', 'department', 'admin')

    PUBLIC("public", "公开"),
    CAMPUS("campus", "校园"),
    STUDENT("student", "学生"),
    TEACHER("teacher", "教师"),
    DEPARTMENT("department", "部门"),
    ADMIN("admin", "管理员");

    /**
     * MyBatis-Plus 用这个字段读写数据库，Jackson 也用这个值做序列化。
     * 必须加 @EnumValue：否则 MyBatis 会退化成按枚举常量名（PUBLIC/STUDENT/...）解析，
     * 数据库里存的却是小写 code（public/student/...），查出来会抛
     * IllegalArgumentException: No enum constant ...VisibilityEnum.student。
     */
    @EnumValue
    @JsonValue
    private String code;
    private String message;

    VisibilityEnum(String code, String message) {
        this.code = code;
        this.message = message;
    }

    @JsonCreator
    public static VisibilityEnum fromCode(String code) {
        if (code == null || code.isBlank()) {
            return null;
        }
        for (VisibilityEnum e : values()) {
            if (e.code.equalsIgnoreCase(code) || e.name().equalsIgnoreCase(code)) {
                return e;
            }
        }
        throw new IllegalArgumentException("无效的 VisibilityEnum: " + code);
    }
}
