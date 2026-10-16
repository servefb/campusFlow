package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.po.KnowledgeCategories;
import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.service.entity.vo.KnowledgeCategoriesVo;

import java.util.List;
import java.util.Map;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface IKnowledgeCategoriesService extends IService<KnowledgeCategories> {

    Result<KnowledgeCategoriesVo> getKnowledgeCategories();

}
