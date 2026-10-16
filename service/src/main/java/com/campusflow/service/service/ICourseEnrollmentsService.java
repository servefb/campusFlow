package com.campusflow.service.service;

import com.campusflow.service.entity.po.CourseEnrollments;
import com.baomidou.mybatisplus.extension.service.IService;
import java.util.List;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
public interface ICourseEnrollmentsService extends IService<CourseEnrollments> {

    int saveBatchAndUpdateEnrolled(List<CourseEnrollments> enrollments, Long termId);
}
