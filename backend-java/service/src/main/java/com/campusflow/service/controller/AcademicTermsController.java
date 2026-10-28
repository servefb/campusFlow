package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
import com.campusflow.service.entity.vo.AcademicTermsVo;
import com.campusflow.service.service.IAcademicTermsService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import org.springframework.web.bind.annotation.RestController;

/**
 * <p>
 *  前端控制器
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
@RestController
@RequestMapping("/courses/terms")
@RequiredArgsConstructor
public class AcademicTermsController {
    private final IAcademicTermsService academicTermsService;

    @GetMapping
    public Result<AcademicTermsVo> getAcademicTerms(Boolean current_only) {
        return academicTermsService.getAcademicTerms(current_only);
    }


}
