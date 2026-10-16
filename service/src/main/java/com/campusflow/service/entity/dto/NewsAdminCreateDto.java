package com.campusflow.service.entity.dto;

import lombok.Data;

/**
 * {@code POST /news/admin/news} —— 手动发布新闻（数据表 {@code campus_news} 里
 * {@code news_sources.source_type='manual'} 的那条路径）。
 *
 * <h3>为什么这个接口是「后端先备好、前端还没有按钮」</h3>
 * 数据模型早就支持了（{@code cover_file_id} / {@code status} / {@code visibility} /
 * {@code is_spotlight} 都在），但接口文档第 12 章只覆盖了新闻源治理，没有发布接口 ——
 * 于是管理端只能「管源」不能「发稿」。本轮把接口补上，管理端的发布表单随后接
 * （不发假按钮是既有约定：先有真接口，再有真按钮）。
 *
 * <h3>两个状态字段的区别</h3>
 * <ul>
 *   <li>{@code status}：{@code draft / published / offline / archived}，稿件的生命周期；</li>
 *   <li>{@code published_at}：发布时间。{@code status=published} 且未给 {@code published_at} 时
 *       由服务端补当前时刻 —— 否则新闻流按 {@code published_at DESC} 排序，
 *       这一条会永远沉在列表最底（{@code NULL} 在 MySQL 升序排最前、降序排最后）。</li>
 * </ul>
 *
 * @author JIA
 * @since 2026-09-23
 */
@Data
public class NewsAdminCreateDto {

    private String title;

    private String summary;

    private String content;

    /** 分类名，直接落 {@code campus_news.category}（新闻流的 category 筛选也按这个名字）。 */
    private String category;

    /** {@code public / campus / student / teacher / department / admin}，缺省 campus。 */
    private String visibility;

    /** 封面文件 id，必须来自 {@code POST /files/presign} 且扫描状态已是 ready。 */
    private String cover_file_id;

    /** {@code draft}（缺省）或 {@code published}。 */
    private String status;

    /** 是否置顶（首页轮播位）。 */
    private Boolean is_spotlight;

    /** 报名 / 办事截止时间，{@code yyyy-MM-dd HH:mm:ss}；可空。 */
    private String deadline_at;
}
