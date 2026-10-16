package com.campusflow.common.enums;

import com.baomidou.mybatisplus.annotation.EnumValue;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum TaskStatusEnum {

    DRAFT("draft", "草稿"),
    IN_PROGRESS("in_progress", "进行中"),
    MATERIAL_REQUIRED("material_required", "待补材料"),
    UNDER_REVIEW("under_review", "审核中"),
    COMPLETED("completed", "已完成"),
    CANCELLED("cancelled", "已取消");

    @EnumValue          // MyBatis-Plus 用这个字段读写数据库
    @JsonValue          // Jackson 序列化时输出这个值
    private final String code;

    private final String message;

    TaskStatusEnum(String code, String message) {
        this.code = code;
        this.message = message;
    }

    @JsonCreator        // Jackson 反序列化时用这个解析
    public static TaskStatusEnum fromCode(String code) {
        if (code == null || code.isBlank()) {
            return null;
        }
        for (TaskStatusEnum e : values()) {
            if (e.code.equalsIgnoreCase(code) || e.name().equalsIgnoreCase(code)) {
                return e;
            }
        }
        throw new IllegalArgumentException("无效的 TaskStatusEnum: " + code);
    }
}