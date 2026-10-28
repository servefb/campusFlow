package com.campusflow.service.entity.vo;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;


@Data
@Builder
public class KnowledgeDocumentDetailVo {
    private Long id;
    private String title;
    private String document_no;
    private Issuer issuer;
    private Category category;
    private String validity;
    private String visibility;
    private String publishedAt;
    private String effectiveFrom;
    private Signature signature;
    private Index index;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static
    class Issuer {
        private Long id;
        private String name;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static
    class Category {
        private Long id;
        private String name;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static
    class Signature {
        private String algorithm;
        private String digest;
        private Boolean verified;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static
    class Index {
        private String status;
        private String updatedAt;
    }
}
