package com.campusflow.service.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.NewsAdminCreateDto;
import com.campusflow.service.entity.dto.NewsAdminUpdateDto;
import com.campusflow.service.entity.po.CampusNews;

import java.util.Map;

/**
 * 管理端新闻发布（{@code /news/admin/news*}）。
 *
 * <p>接口文档第 12 章只有<b>新闻源治理</b>，没有发布接口；但数据模型是齐的
 * （{@code campus_news} 有 {@code cover_file_id} / {@code status} / {@code visibility} /
 * {@code is_spotlight} / {@code deadline_at}，{@code news_sources.source_type} 里也有 {@code manual}）。
 * 本接口就是补上这块缺口，路径按文档风格拟定。
 *
 * <p>写操作全部记审计（{@code @MyLog}）：发新闻是对外可见的动作，谁在什么时候上了什么稿
 * 必须可追 —— 这也是它比「编辑新闻源」更需要留痕的地方。
 *
 * @author JIA
 * @since 2026-09-23
 */
public interface IAdminNewsService extends IService<CampusNews> {

    /** {@code POST /news/admin/news} —— 新建稿件（草稿或直接发布）。 */
    Result<Map<String, Object>> createNews(NewsAdminCreateDto payload);

    /** {@code PATCH /news/admin/news/{id}} —— 改稿 / 上下线 / 置顶。 */
    Result<Map<String, Object>> updateNews(String id, NewsAdminUpdateDto payload);

    /** {@code DELETE /news/admin/news/{id}} —— 软删除（表里已有 {@code deleted_at}）。 */
    Result<Map<String, Object>> deleteNews(String id);
}
