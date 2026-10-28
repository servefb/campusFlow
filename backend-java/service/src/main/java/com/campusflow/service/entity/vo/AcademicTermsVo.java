package com.campusflow.service.entity.vo;

import lombok.Data;

import java.util.List;

@Data
public class AcademicTermsVo {


    private List<AcademicTerms> items;

    @Data
    public static class AcademicTerms{
        private Long id;
        private String code;
        private String name;
        private String start_date;
        private String end_date;
        private Boolean is_current;
    }

}
