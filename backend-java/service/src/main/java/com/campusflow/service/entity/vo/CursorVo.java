package com.campusflow.service.entity.vo;


import lombok.AllArgsConstructor;
import lombok.Data;

import java.math.BigDecimal;

@Data
public class CursorVo {


    private Long id;
    private String course_code;
    private String name;
    private String english_name;
    private String course_type;
    private BigDecimal credit;
    private Integer total_hours;
    private OrganizationVo organization;


    @AllArgsConstructor
    @Data
    public static
    class OrganizationVo {
        private Long id;
        private String name;
    }
}
