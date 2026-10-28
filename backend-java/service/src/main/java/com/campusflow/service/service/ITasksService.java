package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.CreateTaskDto;
import com.campusflow.service.entity.dto.TaskQueryDto;
import com.campusflow.service.entity.po.Tasks;
import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.service.entity.vo.*;

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
public interface ITasksService extends IService<Tasks> {

    Result getTasks(TaskQueryDto taskQueryDto);

    Result getTasksSummary();


    Result<TaskDetailVo> getTaskDetail(Long taskId);

    Result<Map<String, List<TaskRequirementsVo>>> getTaskRequirements(Long taskId);

    Result<Map<String, List<TaskTimeLineVo>>> getTaskTimeline(Long taskId);

    Result<TaskVo> createTask(CreateTaskDto createTaskDto);



}
