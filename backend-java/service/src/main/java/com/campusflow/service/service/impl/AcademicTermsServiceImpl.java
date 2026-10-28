package com.campusflow.service.service.impl;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.po.AcademicTerms;
import com.campusflow.service.entity.vo.AcademicTermsVo;
import com.campusflow.service.mapper.AcademicTermsMapper;
import com.campusflow.service.service.IAcademicTermsService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;


/**
 * <p>
 * 服务实现类
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
@Service
public class AcademicTermsServiceImpl extends ServiceImpl<AcademicTermsMapper, AcademicTerms> implements IAcademicTermsService {


    @Override
    public Result<AcademicTermsVo> getAcademicTerms(Boolean currentOnly) {
        List<AcademicTerms> academicTermsList = lambdaQuery().eq(currentOnly != null, AcademicTerms::getIsCurrent, currentOnly).list();
        List<AcademicTermsVo.AcademicTerms> TermsList = new LinkedList<>();
        academicTermsList.forEach(at -> {
            AcademicTermsVo.AcademicTerms academicTerms = new AcademicTermsVo.AcademicTerms();
            academicTerms.setId(at.getId());
            academicTerms.setCode(at.getTermCode());
            academicTerms.setName(at.getTermName());
            academicTerms.setStart_date(at.getStartDate().toString());
            academicTerms.setEnd_date(at.getEndDate().toString());

            TermsList.add(academicTerms);
        });
        AcademicTermsVo academicTermsVo = new AcademicTermsVo();
        academicTermsVo.setItems(TermsList);
        return new Result<AcademicTermsVo>().success(academicTermsVo);
    }

    @Cacheable(cacheNames = "TermCode")
    @Override
    public Map<String, String> currentTermCode() {

        Map<String, String> map = new HashMap<>();
        AcademicTerms one = lambdaQuery().eq(AcademicTerms::getIsCurrent, 1).one();

        map.put("termCode", one.getTermCode());
        map.put("id", one.getId().toString());

        return map;
    }
}
