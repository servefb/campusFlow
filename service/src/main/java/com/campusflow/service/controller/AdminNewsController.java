package com.campusflow.service.controller;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.NewsAdminCreateDto;
import com.campusflow.service.entity.dto.NewsAdminUpdateDto;
import com.campusflow.service.service.IAdminNewsService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 管理端新闻发布（{@code /news/admin/news*}）。
 *
 * <h3>与 {@code /news} 的关系</h3>
 * {@code CampusNewsController}（{@code /news}、{@code /news/home}、{@code /news/{id}}）是
 * <b>面向学生端</b>的只读接口；本类是<b>管理端</b>的写接口。两者读写同一张 {@code campus_news}，
 * 但鉴权级别与字段集都不同（管理端能看到草稿、能改可见范围），所以刻意分成两个 Controller，
 * 而不是往只读接口上加 {@code POST} —— 那种混用会让「普通用户能不能调写接口」变成一个
 * 需要逐行读代码才能回答的问题。
 *
 * @author JIA
 * @since 2026-09-23
 */
@RestController
@RequestMapping("/news/admin/news")
@AllArgsConstructor
public class AdminNewsController {

    private final IAdminNewsService adminNewsService;

    /** {@code POST /news/admin/news} —— 新建稿件（{@code status=draft} 存草稿，{@code published} 直接发布）。 */
    @PostMapping
    public Result<Map<String, Object>> create(@RequestBody NewsAdminCreateDto payload) {
        return adminNewsService.createNews(payload);
    }

    /** {@code PATCH /news/admin/news/{id}} —— 改稿 / 上下线 / 置顶。 */
    @PatchMapping("/{id}")
    public Result<Map<String, Object>> update(@PathVariable("id") String id,
                                             @RequestBody NewsAdminUpdateDto payload) {
        return adminNewsService.updateNews(id, payload);
    }

    /** {@code DELETE /news/admin/news/{id}} —— 软删除（写 {@code deleted_at}）。 */
    @DeleteMapping("/{id}")
    public Result<Map<String, Object>> delete(@PathVariable("id") String id) {
        return adminNewsService.deleteNews(id);
    }
}
