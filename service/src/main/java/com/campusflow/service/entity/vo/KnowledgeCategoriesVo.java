package com.campusflow.service.entity.vo;

import lombok.Data;

import java.util.List;

@Data
public class KnowledgeCategoriesVo {

    private List<KnowledgeCategoriesDetail> items;
    @Data
    public static class KnowledgeCategoriesDetail {
        private Long id;
        private String name;
        private Long document_count;
    }
}
