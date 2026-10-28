package com.campusflow.service.config;

import com.campusflow.common.enums.ValidityEnum;
import com.campusflow.common.enums.VisibilityEnum;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.format.FormatterRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 让 URL 查询参数里的枚举按业务 code 绑定，例如 ?validity=current。
 * <p>
 * Spring MVC 默认只按枚举常量名绑定（Enum.valueOf），也就是只认 CURRENT/REVISED/...，
 * 前端传数据库里的 code（current/revised/...）会直接抛转换失败，被包装成
 * MethodArgumentNotValidException 返回 400 Bad Request。
 * 这里统一委托给各枚举自己的 fromCode 解析，绑定口径与 JSON、数据库保持一致。
 */
@Configuration
public class EnumQueryConverterConfig implements WebMvcConfigurer {

    @Override
    public void addFormatters(FormatterRegistry registry) {
        registry.addConverter(new ValidityEnumConverter());
        registry.addConverter(new VisibilityEnumConverter());
    }

    /**
     * 把 validity=current / CURRENT 绑定到 {@link ValidityEnum}；
     * 空串或空白按“不筛选”处理（返回 null，查询条件会被忽略）。
     */
    static class ValidityEnumConverter implements Converter<String, ValidityEnum> {
        @Override
        public ValidityEnum convert(String source) {
            return ValidityEnum.fromCode(source);
        }
    }

    static class VisibilityEnumConverter implements Converter<String, VisibilityEnum> {
        @Override
        public VisibilityEnum convert(String source) {
            return VisibilityEnum.fromCode(source);
        }
    }
}
