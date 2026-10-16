package com.campusflow.service.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.campusflow.service.entity.po.ContentReviews;

/**
 * 内容审核工单 Mapper（管理端 {@code /admin/reviews*}）。
 *
 * <p>队列的筛选/排序条件都在 {@code AdminReviewsServiceImpl} 里用 {@code LambdaQueryWrapper}
 * 拼（可空条件多、又要把「哨兵值」过滤掉，写在 XML/注解里反而难读），
 * 这里只需要 {@code BaseMapper} 的能力。
 *
 * @author JIA
 * @since 2026-09-23
 */
public interface ContentReviewsMapper extends BaseMapper<ContentReviews> {
}
