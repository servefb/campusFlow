package com.campusflow.service.service;

import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.KnowledgeDocumentDto;
import com.campusflow.service.entity.po.KnowledgeDocuments;
import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.service.entity.vo.KnowledgeDocumentDetailVo;
import com.campusflow.service.entity.vo.KnowledgeDocumentVo;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface IKnowledgeDocumentsService extends IService<KnowledgeDocuments> {

    BaseQueryVo<KnowledgeDocumentVo> getKnowledgeDocuments(KnowledgeDocumentDto knowledgeDocumentDto);

    Result<KnowledgeDocumentDetailVo> getKnowledgeDocumentById(String id);
}
