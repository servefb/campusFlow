package com.campusflow.service.entity.vo;


import com.campusflow.common.constant.NewConstant;
import com.campusflow.service.entity.po.CampusNews;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;

import java.util.List;
import java.util.Map;

@Builder
@Data
@AllArgsConstructor
public class GetHomeNewsVo {

    private RecommendNews spotlight;
    private List<RecommendNews> recommendations;

    private Map<String, List<CampusNews>> groups;

    public GetHomeNewsVo() {
    }


    private List<Categories> categories;


    @Data
    @Builder
    public static class RecommendNews {
        private Long id;
        private String title;
        private String cover_url;
        private String recommendation_reason;
        private String published_at;
    }

    public static RecommendNews toRecommendNews(CampusNews campusNews, String recommendationReason, String coverUrl) {
        return RecommendNews.builder()
                .id(Long.parseLong(campusNews.getId()))
                .title(campusNews.getTitle())
                .cover_url(coverUrl)
                .recommendation_reason(recommendationReason)
                .published_at(campusNews.getPublishedAt().toString())
                .build();
    }

    @Data
    @Builder
    public static class Categories {
        private String key;
        private String name;
        private long count;
    }

    public static Categories toCategories(String key, String name, long count) {
        return Categories.builder()
                .key(key)
                .name(name)
                .count(count)
                .build();
    }

    private Integer following_count;


}
