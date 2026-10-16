package com.campusflow.common.enums;

import com.baomidou.mybatisplus.annotation.EnumValue;
import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.Getter;

@Getter
public enum StepStatusEnum {

    PENDING("pending", "待处理"),
    ACTIVE("active", "进行中"),
    COMPLETED("completed", "已完成"),
    REJECTED("rejected", "已驳回"),
    SKIPPED("skipped", "已跳过");

    @EnumValue          // MyBatis-Plus 用这个字段读写数据库
    @JsonValue          // Jackson 序列化时输出这个值
    private final String code;

    private final String message;

    StepStatusEnum(String code, String message) {
        this.code = code;
        this.message = message;
    }

    @JsonCreator        // Jackson 反序列化时用这个解析
    public static StepStatusEnum fromCode(String code) {
        if (code == null || code.isBlank()) {
            return null;
        }
        for (StepStatusEnum e : values()) {
            if (e.code.equalsIgnoreCase(code) || e.name().equalsIgnoreCase(code)) {
                return e;
            }
        }
        throw new IllegalArgumentException("无效的 StepStatusEnum: " + code);
    }

    /**
     * 业务代码用：查不到返回 null，不抛异常
     */
    public static StepStatusEnum fromCodeOrNull(String code) {
        if (code == null || code.isBlank()) {
            return null;
        }
        for (StepStatusEnum e : values()) {
            if (e.code.equalsIgnoreCase(code) || e.name().equalsIgnoreCase(code)) {
                return e;
            }
        }
        return null;
    }

    /**
     * 是否为终态（不可再流转）
     */
    public boolean isFinal() {
        return this == COMPLETED || this == REJECTED || this == SKIPPED;
    }
}