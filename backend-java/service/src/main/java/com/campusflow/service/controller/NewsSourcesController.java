package com.campusflow.service.controller;

import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.NewsSourceQueryDto;
import com.campusflow.service.entity.dto.NewsSourceUpdateDto;
import com.campusflow.service.entity.vo.NewsSourceVo;
import com.campusflow.service.service.INewsSourcesService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 新闻源治理（{@code /news/admin/sources*}，契约文档第 12 章 A.7.9 ~ A.7.11）。
 *
 * <h3>⚠️ 路径从 {@code /news-sources} 改成了 {@code /news/admin/sources}</h3>
 * 这个类原先只有一行 {@code @RequestMapping("/news-sources")}、方法全空（代码生成器产物）。
 * 管理端调的路径是 {@code /news/admin/sources}（接口文档第 12 章），
 * 两边对不上，所以 live 模式下「新闻治理」页一直 404。这里按契约改，
 * <b>不是</b>把契约改成迁就实现 —— 变更记录在《接口对接说明.md》。
 *
 * <h3>权限</h3>
 * 文档明确这三个都是<b>管理员接口</b>，普通令牌 403 属预期。管理端页面已经对 403 做了提示，
 * 不是报错弹窗。
 *
 * @author JIA
 * @since 2026-09-23
 */
@RestController
@RequestMapping("/news/admin/sources")
@AllArgsConstructor
public class NewsSourcesController {

    private final INewsSourcesService newsSourcesService;

    /** {@code GET /news/admin/sources} —— 新闻源列表。 */
    @GetMapping
    public Result<BaseQueryVo<NewsSourceVo>> list(NewsSourceQueryDto query) {
        return newsSourcesService.listSources(query);
    }

    /** {@code PATCH /news/admin/sources/{id}} —— 停用/启用、改同步周期、改选择器。 */
    @PatchMapping("/{id}")
    public Result<Map<String, Object>> update(@PathVariable("id") String id,
                                             @RequestBody NewsSourceUpdateDto payload) {
        return newsSourcesService.updateSource(id, payload);
    }

    /**
     * {@code POST /news/admin/sources/{id}/sync} —— 立即同步。
     *
     * <p>当前返回 501 + 原因（全工程没有抓取执行器，见 {@code INewsSourcesService#syncSource} 注释）。
     * 之所以不是 404，是为了让调用方能区分「接口没做」与「接口做了但执行器没部署」——
     * 这两种情况要采取的动作完全不同。
     */
    @PostMapping("/{id}/sync")
    public Result<Map<String, Object>> sync(@PathVariable("id") String id) {
        return newsSourcesService.syncSource(id);
    }
}
