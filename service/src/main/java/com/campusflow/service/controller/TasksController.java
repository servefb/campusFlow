package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.CreateTaskDto;
import com.campusflow.service.entity.dto.TaskQueryDto;
import com.campusflow.service.entity.vo.TaskDetailVo;
import com.campusflow.service.entity.vo.TaskRequirementsVo;
import com.campusflow.service.entity.vo.TaskTemplatesVo;
import com.campusflow.service.entity.vo.TaskTimeLineVo;
import com.campusflow.service.service.ITaskTemplatesService;
import com.campusflow.service.service.ITasksService;
import lombok.AllArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * <p>
 *  前端控制器
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@RestController
@RequestMapping("/tasks")
@AllArgsConstructor
public class TasksController {
    private ITasksService tasksService;

    private ITaskTemplatesService taskTemplatesService;


    @GetMapping
    public Result getTasks(TaskQueryDto taskQueryDto) {
        return tasksService.getTasks(taskQueryDto);
    }


    @GetMapping("/summary")
    public Result getTasksSummary() {
        return tasksService.getTasksSummary();
    }

    @PostMapping
    public Result createTask(@RequestBody CreateTaskDto createTaskDto) {
        return tasksService.createTask(createTaskDto);
    }

    @GetMapping("/{task_id}")
    public Result<TaskDetailVo> getTaskDetail(@PathVariable("task_id") Long taskId) {
        return tasksService.getTaskDetail(taskId);
    }


    @GetMapping("/{task_id}/requirements")
    public Result<Map<String, List<TaskRequirementsVo>>> getTaskRequirements(@PathVariable("task_id") Long taskId) {
        return tasksService.getTaskRequirements(taskId);
    }

    @GetMapping("/{task_id}/timeline")
    public Result<Map<String, List<TaskTimeLineVo>>> getTaskTimeline(@PathVariable("task_id") Long taskId) {
        return tasksService.getTaskTimeline(taskId);
    }


    @GetMapping("/templates")
    public Result<TaskTemplatesVo> getTaskTemplates() {
        return taskTemplatesService.getTaskTemplates();
    }


    @GetMapping("/templates/{key}/requirements")
    public Result getTaskRequirementsByTemplateKey(@PathVariable("key") String key) {
        return taskTemplatesService.getTaskRequirementsByTemplateKey(key);
    }



}
