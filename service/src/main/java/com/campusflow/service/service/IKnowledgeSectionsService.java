package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.po.KnowledgeSections;
import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.service.entity.vo.KnowledgeSectionContentVo;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface IKnowledgeSectionsService extends IService<KnowledgeSections> {

    Result getChaptersByDocumentId(Long id);

    Result<KnowledgeSectionContentVo> getSectionsByDocumentIdAndSectionId(Long id, Long sectionId);
}
