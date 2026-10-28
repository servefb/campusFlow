package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.context.UserContext;
import com.campusflow.common.enums.StepStatusEnum;
import com.campusflow.common.enums.TaskStatusEnum;
import com.campusflow.common.response.Result;

import com.campusflow.service.entity.dto.CreateTaskDto;
import com.campusflow.service.entity.dto.TaskQueryDto;
import com.campusflow.service.entity.po.*;
import com.campusflow.service.entity.vo.*;
import com.campusflow.service.mapper.TasksMapper;
import com.campusflow.service.service.*;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
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
public class TasksServiceImpl extends ServiceImpl<TasksMapper, Tasks> implements ITasksService {

    private ITaskStepInstancesService taskStepInstancesService;
    private ITaskTemplateRequirementsService taskTemplateRequirementsService;
    private ITaskEventsService taskEventsService;
    private ITaskMaterialsService taskMaterialsService;
    private ITaskTemplatesService taskTemplatesService;
    private IOrganizationsService organizationService;
    private IUsersService usersService;
    private TasksMapper tasksMapper;
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyyMMdd");
    private StringRedisTemplate redisTemplate;


    @Override
    public Result<BaseQueryVo<TaskQueryVo>> getTasks(TaskQueryDto taskQueryDto) {

        if (taskQueryDto == null) {
            throw new IllegalArgumentException("参数为空");
        }
        Long userId = UserContext.getUserId();

        Page<Tasks> page = lambdaQuery().eq(Tasks::getUserId, userId)
                .eq(taskQueryDto.getStatus() != null, Tasks::getStatus, taskQueryDto.getStatus())
                .like(taskQueryDto.getKeyword() != null, Tasks::getTitle, taskQueryDto.getKeyword())
                .orderByDesc(Tasks::getCreatedAt)
                .page(new Page<>(Math.max(1, taskQueryDto.getPage()),
                        taskQueryDto.getPage_size() > 0 ? taskQueryDto.getPage_size() : 10));
        List<Tasks> records = page.getRecords();
        List<Long> tasksIds = new ArrayList<>();

        List<Object> organization = new ArrayList<>();

        records.forEach(task -> {
            tasksIds.add(task.getId());
            organization.add(task.getResponsibleOrganizationId());
        });
        List<TaskStepInstances> list = tasksIds.isEmpty()
                ? Collections.emptyList()
                : taskStepInstancesService.lambdaQuery().in(TaskStepInstances::getTaskId, tasksIds).list();

        // 每个任务的全部步骤（按 taskId 分组），步骤总数 = 该分组列表的长度
        Map<Long, List<TaskQueryVo.currentStep>> stepsByTask = new HashMap<>();
        Map<Long, String> taskInstanceMap = new HashMap<>();
        list.forEach(tsi -> {
                    stepsByTask
                            .computeIfAbsent(tsi.getTaskId(), k -> new ArrayList<>())
                            .add(new TaskQueryVo.currentStep(tsi.getName(), tsi.getStepOrder()));
                    taskInstanceMap.put(tsi.getTaskId(), tsi.getStatus().getCode());
                }

        );


        Map<Long, String> organizationMap = organizationService.lambdaQuery()
                .in(Organizations::getId, organization).list().stream()
                .collect(Collectors.toMap(Organizations::getId, Organizations::getName));


        List<TaskQueryVo> VoList = new ArrayList<>();
        BaseQueryVo<TaskQueryVo> baseQueryVo = new BaseQueryVo<>();
        records.forEach(task -> {
                    TaskQueryVo taskQueryVo = new TaskQueryVo();
                    taskQueryVo.setId(task.getId());
                    taskQueryVo.setTitle(task.getTitle());
                    taskQueryVo.setTask_no(task.getTaskNo());
                    taskQueryVo.setStatus(task.getStatus().getCode());
                    taskQueryVo.setCurrent_step_order(task.getCurrentStepOrder());
                    taskQueryVo.setCreated_at(String.valueOf(task.getCreatedAt()));
                    taskQueryVo.setUpdated_at(String.valueOf(task.getUpdatedAt()));
                    List<TaskQueryVo.currentStep> steps = stepsByTask.getOrDefault(task.getId(), Collections.emptyList());
                    // 当前步骤名称：取步骤序号与任务当前序号一致的那一步；没有则置空
                    String currentStepName = steps.stream()
                            .filter(step -> Objects.equals(step.getCurrentStepOrder(), task.getCurrentStepOrder()))
                            .map(TaskQueryVo.currentStep::getName)
                            .findFirst()
                            .orElse(null);
                    taskQueryVo.setCurrent_step(currentStepName);

                    taskQueryVo.setCurrent_step_status(taskInstanceMap.getOrDefault(task.getId(), null));

                    // 进度 = 当前步骤序号 / 总步骤数，避免除零、防止超过 100
                    int totalSteps = steps.size();
                    taskQueryVo.setTotal_steps(totalSteps);

                    taskQueryVo.setResponsible_organization(new TaskQueryVo.Organization(task.getResponsibleOrganizationId(), organizationMap.get(task.getResponsibleOrganizationId())));

                    VoList.add(taskQueryVo);
                }
        );
        baseQueryVo.setItems(VoList);
        baseQueryVo.setTotal(page.getTotal());
        baseQueryVo.setPage(taskQueryDto.getPage());
        baseQueryVo.setPage_size(taskQueryDto.getPage_size());
        baseQueryVo.setHas_more(page.hasNext());
        return new Result<BaseQueryVo<TaskQueryVo>>().success(baseQueryVo);

    }

    @Override
    public Result getTasksSummary() {

        Long userId = UserContext.getUserId();
        Map<String, Object> sumVoMap = new HashMap<>();
        List<Map<String, Object>> summaryList = tasksMapper.getTasksSummary(userId);
        summaryList.forEach(
                sum -> sumVoMap.put(sum.get("status").toString(), sum.get("total"))
        );
        sumVoMap.put("all", sumVoMap.size());
        return new Result().success(sumVoMap);
    }

    @Override
    public Result<TaskDetailVo> getTaskDetail(Long taskId) {
        if (taskId == null) {
            throw new IllegalArgumentException("参数为空");
        }

        Tasks byId = getById(taskId);
        if (byId == null) {
            throw new IllegalArgumentException("任务不存在");
        }

        List<TaskStepInstances> tsi = taskStepInstancesService.lambdaQuery()
                .eq(TaskStepInstances::getTaskId, taskId).list();

        List<Long> orgId = tsi.stream().map(TaskStepInstances::getOrganizationId).toList();
        Map<Long, String> orgMap = organizationService.lambdaQuery().in(Organizations::getId, orgId).list().stream().collect(Collectors.toMap(Organizations::getId, Organizations::getName));

        List<TaskDetailVo.StepAll> stepAllList = new ArrayList<>();
        TaskDetailVo taskDetailVo = new TaskDetailVo();
        tsi.forEach(tsiTemp -> {
            TaskDetailVo.StepAll stepAll = new TaskDetailVo.StepAll();
            stepAll.setId(tsiTemp.getId());
            stepAll.setStep_order(tsiTemp.getStepOrder());
            stepAll.setName(tsiTemp.getName());
            stepAll.setStatus(tsiTemp.getStatus().getCode());
            stepAll.setOrganization(new TaskQueryVo.Organization(tsiTemp.getOrganizationId(), orgMap.get(tsiTemp.getOrganizationId())));
            stepAll.setAssignee(tsiTemp.getAssigneeUserId());
            stepAll.setResult(tsiTemp.getResult());
            stepAll.setStarted_at(String.valueOf(tsiTemp.getStartedAt()));
            stepAll.setCompleted_at(String.valueOf(tsiTemp.getCompletedAt()));
            stepAll.setDue_at(String.valueOf(tsiTemp.getDueAt()));
            if (tsiTemp.getTaskId().equals(taskId) && Objects.equals(tsiTemp.getStepOrder(), byId.getCurrentStepOrder())) {
                TaskDetailVo.currentStep currentStep = new TaskDetailVo.currentStep(tsiTemp.getName(), tsiTemp.getStatus().getCode());
                taskDetailVo.setCurrent_step(currentStep);
            }
            stepAllList.add(stepAll);
        });

        TaskTemplates taskTemplate = taskTemplatesService.getById(byId.getTemplateId());

        taskDetailVo.setId(byId.getId());
        taskDetailVo.setTitle(byId.getTitle());
        taskDetailVo.setStatus(byId.getStatus().getCode());
        taskDetailVo.setForm_data(byId.getFormData());
        taskDetailVo.setTemplate_key(taskTemplate.getTemplateKey());
        taskDetailVo.setSteps(stepAllList);
        taskDetailVo.setVersion(taskTemplate.getVersion());
        taskDetailVo.setCreated_at(String.valueOf(byId.getCreatedAt()));
        taskDetailVo.setUpdated_at(String.valueOf(byId.getUpdatedAt()));
        return new Result<TaskDetailVo>().success(taskDetailVo);
    }

    @Override
    public Result<Map<String, List<TaskRequirementsVo>>> getTaskRequirements(Long taskId) {

        if (taskId == null) {
            throw new IllegalArgumentException("参数为空");
        }
        Tasks task = getById(taskId);
        if (task == null) {
            throw new IllegalArgumentException("任务不存在");
        }
        Long templateId = task.getTemplateId();


        List<TaskTemplateRequirements> ttr = taskTemplateRequirementsService.lambdaQuery().eq(TaskTemplateRequirements::getTemplateId, templateId).list();
        List<Long> ttrId = ttr.stream().map(TaskTemplateRequirements::getId).toList();

        Map<Long, TaskMaterials> tMap = taskMaterialsService.lambdaQuery().in(TaskMaterials::getRequirementId, ttrId).
                list().stream().collect(Collectors.toMap(TaskMaterials::getRequirementId, tm -> tm));

        Map<String, List<TaskRequirementsVo>> voMap = new HashMap<>();
        voMap.put("items", new ArrayList<>());
        ttr.forEach(ttr1 -> {

            TaskRequirementsVo taskRequirementsVo = new TaskRequirementsVo();
            taskRequirementsVo.setId(ttr1.getId());
            taskRequirementsVo.setName(ttr1.getName());
            taskRequirementsVo.setRequired(ttr1.getIsRequired());
            taskRequirementsVo.setAllowed_types(ttr1.getAllowedContentTypes());
            taskRequirementsVo.setMax_size_mb(ttr1.getMaxSizeBytes() / 1024 / 1024);
            TaskMaterials taskMaterials = tMap.get(ttr1.getId());
            if (taskMaterials != null) {
                taskRequirementsVo.setStatus(taskMaterials.getValidationStatus());
                taskRequirementsVo.setMaterial_id(taskMaterials.getFileId());
            }


            voMap.get("items").add(taskRequirementsVo);
        });

        return new Result<Map<String, List<TaskRequirementsVo>>>().success(voMap);
    }

    @Override
    public Result<Map<String, List<TaskTimeLineVo>>> getTaskTimeline(Long taskId) {

        if (taskId == null) {
            throw new IllegalArgumentException("参数为空");
        }
        Long userId = UserContext.getUserId();

        List<TaskEvents> list = taskEventsService.lambdaQuery().eq(TaskEvents::getTaskId, taskId)
                .eq(TaskEvents::getActorUserId, userId).list();
        Users user = usersService.getById(userId);

        Map<String, List<TaskTimeLineVo>> voMap = new HashMap<>();
        voMap.put("items", new ArrayList<>());
        list.forEach(te -> {

            TaskTimeLineVo taskTimeLineVo = new TaskTimeLineVo();
            taskTimeLineVo.setId(te.getId());
            taskTimeLineVo.setType(te.getEventType());
            taskTimeLineVo.setTitle(te.getTitle());
            taskTimeLineVo.setOperator(user.getName());
            taskTimeLineVo.setCreatedAt(String.valueOf(te.getCreatedAt()));
            voMap.get("items").add(taskTimeLineVo);
        });
        return new Result<Map<String, List<TaskTimeLineVo>>>().success(voMap);
    }


    @AllArgsConstructor
    @Data
    @NoArgsConstructor
    private static class request {
        private String items;
        private String title;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Result<TaskVo> createTask(CreateTaskDto createTaskDto) {

        Long userId = UserContext.getUserId();
        Tasks tasks = new Tasks();
        tasks.setTitle(createTaskDto.getTitle());
        tasks.setTaskNo(nextId());
        tasks.setUserId(userId);
        tasks.setTemplateId(createTaskDto.getTemplateId());
        tasks.setSourceConversationId(createTaskDto.getConversationId());
        tasks.setSourceMessageId(createTaskDto.getSourceMessageId());
        tasks.setFormData(createTaskDto.getReason());
        tasks.setStatus(TaskStatusEnum.IN_PROGRESS);
        tasks.setVersion(1);
        tasks.setCurrentStepOrder(1);
        tasks.setCreatedAt(LocalDateTime.now());
        tasks.setUpdatedAt(LocalDateTime.now());


        AtomicReference<String> currentStepName= new AtomicReference<>("");
        if (!save(tasks)) {
            throw new RuntimeException("创建任务失败");
        }


        List<TaskStepInstances> taskStepInstanceList = new LinkedList<>();

        createTaskDto.getSteps().forEach(step -> {
                    if (step.getStepOrder() == 1) {
                        currentStepName.set(step.getName());
                    }
                    TaskStepInstances taskStepInstances = new TaskStepInstances();
                    taskStepInstances.setTaskId(tasks.getId());
                    taskStepInstances.setStepOrder(step.getStepOrder());
                    taskStepInstances.setName(step.getName());
                    taskStepInstances.setStatus(StepStatusEnum.PENDING);
                    taskStepInstances.setOrganizationId(step.getOrganizationId());
                    //todo 限时时间还没有规定
                    taskStepInstanceList.add(taskStepInstances);

                }
        );
        boolean b1 = taskStepInstancesService.saveBatch(taskStepInstanceList);
        if (!b1) {
            throw new RuntimeException("创建任务失败");
        }
        List<TaskTemplateRequirements> taskTemplateRequirementsList = new ArrayList<>();
        createTaskDto.getRequirements().forEach(requirement -> {
            TaskTemplateRequirements taskTemplateRequirements = new TaskTemplateRequirements();
            taskTemplateRequirements.setTemplateId(createTaskDto.getTemplateId());
            taskTemplateRequirements.setRequirementKey(requirement.getRequirementKey());
            taskTemplateRequirements.setName(requirement.getName());
            taskTemplateRequirements.setAllowedContentTypes(requirement.getAllowedContentTypes().toString());
            taskTemplateRequirements.setMaxSizeBytes(requirement.getMaxSizeBytes());
            taskTemplateRequirements.setIsRequired(requirement.getIsRequired());
            taskTemplateRequirementsList.add(taskTemplateRequirements);

        });
        boolean b = taskTemplateRequirementsService.saveBatch(taskTemplateRequirementsList);
        if (!b) {
            throw new RuntimeException("创建任务失败");
        }

        TaskVo taskVo = new TaskVo();

        taskVo.setId(tasks.getId());
        taskVo.setTitle(tasks.getTitle());

        taskVo.setStatus(tasks.getStatus().getCode());
        taskVo.setVersion(tasks.getVersion());
        taskVo.setCreated_at(String.valueOf(tasks.getCreatedAt()));
        taskVo.setCurrent_step(currentStepName.get());

        return new Result<TaskVo>().success(taskVo);

    }

    public String nextId() {
        String date = LocalDate.now().format(DATE_FMT);
        String key = "biz:id:seq:" + date;


        Long seq = redisTemplate.opsForValue().increment(key);
        if (seq != null && seq == 1L) {
            // 第一次创建，设置 2 天过期，避免 key 堆积
            redisTemplate.expire(key, java.time.Duration.ofDays(2));
        }

        return "ts" + date + String.format("%04d", seq);
    }

}
