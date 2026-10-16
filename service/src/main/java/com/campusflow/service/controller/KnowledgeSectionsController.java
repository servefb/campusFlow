package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
import com.campusflow.service.service.IKnowledgeSectionsService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;

import org.springframework.web.bind.annotation.RestController;

/**
 * <p>
 *  前端控制器
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@RestController
@RequestMapping("/knowledge/documents/")
@AllArgsConstructor
public class KnowledgeSectionsController {

    private IKnowledgeSectionsService knowledgeSectionsService;

    @GetMapping("/{id}/chapters")
    public Result getChaptersByDocumentId(@PathVariable Long id) {
        return knowledgeSectionsService.getChaptersByDocumentId(id);
    }

    @GetMapping("/{id}/sections/{section_id}")
    public Result getSectionsByDocumentIdAndSectionId(@PathVariable Long id, @PathVariable Long section_id) {
        return knowledgeSectionsService.getSectionsByDocumentIdAndSectionId(id, section_id);
    }


}
