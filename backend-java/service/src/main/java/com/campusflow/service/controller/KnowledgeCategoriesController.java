package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
import com.campusflow.service.entity.vo.KnowledgeCategoriesVo;
import com.campusflow.service.service.IKnowledgeCategoriesService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * <p>
 *  前端控制器
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@RestController
@RequestMapping("/knowledge/categories")
@AllArgsConstructor
public class KnowledgeCategoriesController {

    private IKnowledgeCategoriesService knowledgeCategoriesService;
    @GetMapping
    public Result<KnowledgeCategoriesVo> getKnowledgeCategories() {
        return knowledgeCategoriesService.getKnowledgeCategories();
    }



}
