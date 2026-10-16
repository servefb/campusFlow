package com.campusflow.service.mapper;

import com.campusflow.service.entity.po.TaskTemplateRequirements;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;
import java.util.Map;

/**
 * <p>
 *  Mapper 接口
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface TaskTemplateRequirementsMapper extends BaseMapper<TaskTemplateRequirements> {

    @Select("<script>" +
            "SELECT tts.template_id AS templateId, COUNT(*) AS requirementsCount " +
            "FROM task_template_requirements tts " +
            "WHERE tts.template_id IN " +
            "<foreach collection='taskTemplatesIds' item='id' open='(' separator=',' close=')'>" +
            "#{id}" +
            "</foreach> " +
            "GROUP BY tts.template_id" +
            "</script>")
    List<Map<Long, Long>> getTaskTemplateRequirementCount(List<Long> taskTemplatesIds);

}
