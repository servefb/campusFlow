package com.campusflow.service.entity.vo;


import lombok.Data;

import java.util.List;


@Data
public class KnowledgeChapterVo {
    private Long document_id;
    private List<ChapterItem> items;


    @Data
    public static class ChapterItem {
        private String id;
        private String label;
        private String title;
        private String order;
        private List<Section> sections;
    }

    @Data
    public static class Section {
        private String id;
        private String label;
        private String title;
    }

    @Data
    public static class Response {
        private Integer chapterNo;   // 对应 chapter_no
        private Integer articleNo;   // 对应 article_no
        private Long id;
        private String title;


    }

}
