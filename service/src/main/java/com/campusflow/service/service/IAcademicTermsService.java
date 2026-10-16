package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.service.entity.po.AcademicTerms;
import com.campusflow.service.entity.vo.AcademicTermsVo;
import org.springframework.cache.annotation.Cacheable;

import java.util.Map;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
public interface IAcademicTermsService extends IService<AcademicTerms> {

    Result<AcademicTermsVo> getAcademicTerms(Boolean currentOnly);

    @Cacheable(cacheNames = "TermCode")
    Map<String, String> currentTermCode();
}
