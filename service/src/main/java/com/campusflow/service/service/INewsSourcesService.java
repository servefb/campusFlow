package com.campusflow.service.service;

import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.NewsSourceQueryDto;
import com.campusflow.service.entity.dto.NewsSourceUpdateDto;
import com.campusflow.service.entity.po.NewsSources;
import com.campusflow.service.entity.vo.NewsSourceVo;

import java.util.Map;

/**
 * 新闻源治理（契约文档第 12 章，管理端 {@code /news/admin/sources*}）。
 *
 * <p>接口文档里这三个都是**管理员接口**：普通令牌调用返回 403，属预期而非故障。
 *
 * @author JIA
 * @since 2026-09-23
 */
public interface INewsSourcesService extends IService<NewsSources> {

    /**
     * {@code GET /news/admin/sources} —— 新闻源列表。
     *
     * <p>返回契约命名（{@code base_url} / {@code status} / {@code selector.list}…），
     * 不是库列名；映射规则见 {@code NewsSourceUpdateDto} 注释。
     */
    Result<BaseQueryVo<NewsSourceVo>> listSources(NewsSourceQueryDto query);

    /**
     * {@code PATCH /news/admin/sources/{id}} —— 编辑抓取规则（启停、同步周期、选择器）。
     */
    Result<Map<String, Object>> updateSource(String id, NewsSourceUpdateDto payload);

    /**
     * {@code POST /news/admin/sources/{id}/sync} —— 立即同步。
     *
     * <p>⚠️ 当前实现是<b>显式未实现</b>（501 + 原因），不是「入队成功」：
     * 全工程（Java 与 Python 两侧）都<b>没有</b>任何新闻抓取执行器，
     * 入队后不会有消费者去跑它。返回「已创建同步任务」等于给管理员一个永远不会完成的承诺 ——
     * 本项目对这类「假按钮」的既有约定是一律不做。抓取执行器落地后，
     * 把这个方法换成真实入队即可，契约不用改。
     */
    Result<Map<String, Object>> syncSource(String id);
}
