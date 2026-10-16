package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.GetNewsHome;
import com.campusflow.service.entity.dto.NewPageDto;
import com.campusflow.service.service.ICampusNewsService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * <p>
 *  前端控制器
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@RestController
@RequestMapping("/news")
@AllArgsConstructor
public class CampusNewsController {

    private final ICampusNewsService campusNewsService;


    @GetMapping("/home")
    public Result getHomeNews(GetNewsHome getNewsHome) {
        return campusNewsService.getHomeNews(getNewsHome);
    }

    @GetMapping("/{news_id}")
    public Result getNewsById(@PathVariable("news_id") Long newsId) {
        return campusNewsService.getNewsById(newsId);
    }

    @GetMapping
    private Result getNewsList(NewPageDto newPageDto) {
        return campusNewsService.getNewsList(newPageDto);
    }

    @GetMapping("/categories")
    public Result getNewsCategories() {
        return campusNewsService.getNewsCategories();
    }

    @PostMapping("/{news_id}/bookmark")
    public Result bookmarkNews(@PathVariable("news_id") Long newsId) {
        return campusNewsService.bookmarkNews(newsId);
    }

    @DeleteMapping("/{news_id}/bookmark")
    public Result removeBookmark(@PathVariable("news_id") Long newsId) {
        return campusNewsService.removeBookmark(newsId);
    }


}
