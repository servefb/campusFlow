package com.campusflow.service.entity.vo;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.List;


@Data
public class CursorDetailVo {

    private CursorVo cursor;
    private String description;
    private List<Prerequisite> prerequisites;

    @Data
    @AllArgsConstructor
    public static class Prerequisite {
        private Long id;
        private String course_code;
        private String name;
    }
}
