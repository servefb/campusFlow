package com.campusflow.service.service.impl;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.po.Organizations;
import com.campusflow.service.entity.po.TaskTemplateRequirements;
import com.campusflow.service.entity.po.TaskTemplateSteps;
import com.campusflow.service.entity.po.TaskTemplates;
import com.campusflow.service.entity.vo.TaskRequirementsByTemplateKeyVo;
import com.campusflow.service.entity.vo.TaskTemplatesVo;
import com.campusflow.service.mapper.TaskTemplateRequirementsMapper;
import com.campusflow.service.mapper.TaskTemplateStepsMapper;
import com.campusflow.service.mapper.TaskTemplatesMapper;
import com.campusflow.service.service.IOrganizationsService;
import com.campusflow.service.service.ITaskTemplateRequirementsService;
import com.campusflow.service.service.ITaskTemplateStepsService;
import com.campusflow.service.service.ITaskTemplatesService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.AllArgsConstructor;
import org.jetbrains.annotations.NotNull;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * <p>
 * 服务实现类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@Service
@AllArgsConstructor
public class TaskTemplatesServiceImpl extends ServiceImpl<TaskTemplatesMapper, TaskTemplates> implements ITaskTemplatesService {

    private IOrganizationsService organizationsService;
    private TaskTemplateStepsMapper taskTemplateStepsMapper;
    private TaskTemplateRequirementsMapper taskTemplateRequirementsMapper;


    private ITaskTemplateStepsService taskTemplateStepsService;
    private ITaskTemplateRequirementsService taskTemplateRequirementsService;

    @Override
    public Result<TaskTemplatesVo> getTaskTemplates() {
        List<TaskTemplates> taskTemplatesList = lambdaQuery().eq(TaskTemplates::getIsActive, true).list();

        // ⚠️ 没有任何启用模板时必须提前返回：下面的 IN (...) 用空集合会拼成 `IN ()`，
        //    MySQL 直接语法报错（500），前端只会看到「模板列表暂不可用」，查不出原因。
        if (taskTemplatesList.isEmpty()) {
            return new Result<TaskTemplatesVo>().success(new TaskTemplatesVo(new ArrayList<>()));
        }

        List<Long> taskTemplatesIds = new ArrayList<>();
        List<Long> organizationIds = new ArrayList<>();
        taskTemplatesList.forEach(taskTemplates -> {
            taskTemplatesIds.add(taskTemplates.getId());
            organizationIds.add(taskTemplates.getResponsibleOrganizationId());
            ;
        });

        List<Organizations> organizationsList = organizationsService.lambdaQuery().in(Organizations::getId, organizationIds).list();
        Map<Long, String> organizationNameMap = organizationsList.stream().collect(Collectors.toMap(Organizations::getId, Organizations::getName));
        List<Map<Long, Long>> stepCountList = taskTemplateStepsMapper.getStepCount(taskTemplatesIds);
        Map<Long, Long> stepCountMap = stepCountList.stream().collect(Collectors.toMap(map -> map.get("templateId"), map -> map.get("stepCount")));
        List<Map<Long, Long>> requirementCountList = taskTemplateRequirementsMapper.getTaskTemplateRequirementCount(taskTemplatesIds);
        // ⚠️ 别名是 requirementsCount（复数），取值必须同名：写成 requirementCount 会取到 null，
        //    而 Collectors.toMap 的 value 为 null 会抛 NPE（HashMap.merge 不接受 null value），
        //    结果整个接口 500 —— 前端「办事模板」下拉直接空掉（2026-09-15 实测就是这个原因）。
        //    这里顺手把 null 行滤掉，避免以后别名再改名又把接口整挂。
        Map<Long, Long> requirementCountMap = requirementCountList.stream()
                .filter(map -> map.get("templateId") != null && map.get("requirementsCount") != null)
                .collect(Collectors.toMap(map -> map.get("templateId"), map -> map.get("requirementsCount")));

        List<TaskTemplatesVo.TaskTemplates> taskTemplatesVoList = new ArrayList<>();
        for (TaskTemplates taskTemplates : taskTemplatesList) {
            TaskTemplatesVo.TaskTemplates taskTemplatesVo = new TaskTemplatesVo.TaskTemplates();
            taskTemplatesVo.setId(taskTemplates.getId());
            taskTemplatesVo.setTemplate_key(taskTemplates.getTemplateKey());
            taskTemplatesVo.setName(taskTemplates.getName());
            taskTemplatesVo.setDescription(taskTemplates.getDescription());
            taskTemplatesVo.setResponsible_organization_name(organizationNameMap.get(taskTemplates.getResponsibleOrganizationId()));
            taskTemplatesVo.setRequirement_count(requirementCountMap.get(taskTemplates.getId()));
            taskTemplatesVo.setStep_count(stepCountMap.get(taskTemplates.getId()));
            taskTemplatesVoList.add(taskTemplatesVo);
        }
        return new Result<TaskTemplatesVo>().success(new TaskTemplatesVo(taskTemplatesVoList));
    }

    @Override
    public Result<TaskRequirementsByTemplateKeyVo> getTaskRequirementsByTemplateKey(String key) {

        TaskTemplates one = lambdaQuery().eq(TaskTemplates::getTemplateKey, key).one();
        if (one == null) {
            throw new IllegalArgumentException("Template key does not exist");
        }
        Long id = one.getId();

        List<TaskTemplateSteps> list = taskTemplateStepsService.lambdaQuery().eq(TaskTemplateSteps::getTemplateId, id).list();
        TaskRequirementsByTemplateKeyVo taskRequirementsByTemplateKeyVo = new TaskRequirementsByTemplateKeyVo();
        List<TaskRequirementsByTemplateKeyVo.Steps> stepsList = getSteps(list);
        List<TaskTemplateRequirements> taskTemplateRequirementsList = taskTemplateRequirementsService.lambdaQuery().eq(TaskTemplateRequirements::getTemplateId, id).list();
        List<TaskRequirementsByTemplateKeyVo.Requirements> requirementsList = taskTemplateRequirementsList.stream().map(taskTemplateRequirements -> {
            TaskRequirementsByTemplateKeyVo.Requirements requirements = new TaskRequirementsByTemplateKeyVo.Requirements();
            requirements.setRequirement_key(taskTemplateRequirements.getRequirementKey());
            requirements.setName(taskTemplateRequirements.getName());
            requirements.setAllowed_content_types(taskTemplateRequirements.getAllowedContentTypes());
            requirements.setMax_size_bytes(taskTemplateRequirements.getMaxSizeBytes());
            requirements.setIs_required(taskTemplateRequirements.getIsRequired());
            return requirements;
        }).toList();

        taskRequirementsByTemplateKeyVo.setTemplate_key(key);
        taskRequirementsByTemplateKeyVo.setSteps(stepsList);
        taskRequirementsByTemplateKeyVo.setRequirements(requirementsList);
        return new Result<TaskRequirementsByTemplateKeyVo>().success(taskRequirementsByTemplateKeyVo);
    }

    @NotNull
    private static List<TaskRequirementsByTemplateKeyVo.Steps> getSteps(List<TaskTemplateSteps> list) {
        List<TaskRequirementsByTemplateKeyVo.Steps> stepsList = new ArrayList<>();
        for (TaskTemplateSteps taskTemplateSteps : list) {
            TaskRequirementsByTemplateKeyVo.Steps steps = new TaskRequirementsByTemplateKeyVo.Steps();
            steps.setStep_id(taskTemplateSteps.getId());
            steps.setStep_order(taskTemplateSteps.getStepOrder());
            steps.setName(taskTemplateSteps.getName());
            steps.setOrganization_id(taskTemplateSteps.getOrganizationId());
            steps.setRequires_user_action(taskTemplateSteps.getRequiresUserAction());
            stepsList.add(steps);
        }
        return stepsList;
    }
}
