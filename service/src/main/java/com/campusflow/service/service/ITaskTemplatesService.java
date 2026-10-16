package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.po.TaskTemplates;
import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.service.entity.vo.TaskRequirementsByTemplateKeyVo;
import com.campusflow.service.entity.vo.TaskTemplatesVo;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface ITaskTemplatesService extends IService<TaskTemplates> {

    Result<TaskTemplatesVo> getTaskTemplates();

    Result<TaskRequirementsByTemplateKeyVo> getTaskRequirementsByTemplateKey(String key);
}
