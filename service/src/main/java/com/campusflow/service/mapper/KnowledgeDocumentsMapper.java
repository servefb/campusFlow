package com.campusflow.service.mapper;

import com.campusflow.service.entity.po.KnowledgeDocuments;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;

/**
 * <p>
 * Mapper 接口
 * </p>
 *
 * <p>2026-10-15：删除了 {@code getGroceryDocumentCount}（按分类统计文档数）。
 * 那条 SQL 不带 {@code deleted_at} / {@code status} / 可见性任何过滤，
 * 统计出的数字和用户实际能看到的列表对不上；现由
 * {@code KnowledgeCategoriesServiceImpl#countVisibleDocuments} 用带过滤条件的
 * GROUP BY 查询取代（与列表接口同一套口径）。</p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface KnowledgeDocumentsMapper extends BaseMapper<KnowledgeDocuments> {

}
