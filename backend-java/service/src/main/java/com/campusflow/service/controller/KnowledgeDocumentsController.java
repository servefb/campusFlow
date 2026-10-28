package com.campusflow.service.controller;


import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.KnowledgeDocumentDto;
import com.campusflow.service.entity.vo.KnowledgeDocumentDetailVo;
import com.campusflow.service.entity.vo.KnowledgeDocumentVo;
import com.campusflow.service.service.IKnowledgeDocumentsService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;

import org.springframework.web.bind.annotation.RestController;

/**
 * <p>
 * 前端控制器
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@RestController
@RequestMapping("/knowledge/documents")
@AllArgsConstructor
public class KnowledgeDocumentsController {

    private IKnowledgeDocumentsService knowledgeDocumentsService;

    @GetMapping
    public Result getKnowledgeDocuments(KnowledgeDocumentDto knowledgeDocumentDto) {
        return new Result().success(knowledgeDocumentsService.getKnowledgeDocuments(knowledgeDocumentDto));
    }

    @GetMapping("/{id}")
    public Result<KnowledgeDocumentDetailVo> getKnowledgeDocumentById(@PathVariable String id) {
        return knowledgeDocumentsService.getKnowledgeDocumentById(id);
    }

}
