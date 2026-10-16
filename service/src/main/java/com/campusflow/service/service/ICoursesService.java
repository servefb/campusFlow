package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.CoursesDto;
import com.campusflow.service.entity.po.Courses;
import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.service.entity.vo.CursorVo;
import jakarta.servlet.http.HttpServletRequest;

import java.util.List;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
public interface ICoursesService extends IService<Courses> {

    Result<List<CursorVo>>    getCourses(CoursesDto coursesDto);

    Result<?> getCourseById(Long courseId);

    Result<?> getCourseOfferings(Long courseId, Integer termId);

    Result<?> getMyCourses(Integer termId, Integer page, Integer pageSize);

    Result<?> getEnrollToken(Long offeringId);

    Result<?> enrollCourse(Long offeringId, Long course_id, HttpServletRequest request, String term_code);

    Result<?> getCourseOffering(Long offeringId);

}
